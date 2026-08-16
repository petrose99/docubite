import { strToU8, zipSync } from "fflate"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mineru = { apiToken: "test-token", apiBase: "https://mineru.test", modelVersion: "vlm", pollIntervalMs: 1, timeoutMs: 5_000 }
vi.mock("@/lib/config", () => ({ default: { mineru } }))

const { parseDocumentWithMineru, splitPagesFromContentList, parseBlocksFromContentList, parsePageSizesFromMiddle } = await import("@/lib/mineru")

const UPLOAD_URL = "https://upload.mineru.test/presigned"
const ZIP_URL = "https://results.mineru.test/batch-1.zip"

function json(body: unknown, init?: { ok?: boolean; status?: number }) {
  return { ok: init?.ok ?? true, status: init?.status ?? 200, text: async () => JSON.stringify(body) }
}

function pollBody(state: string, extra: Record<string, unknown> = {}) {
  return json({ code: 0, data: { batch_id: "batch-1", extract_result: [{ file_name: "invoice.pdf", state, ...extra }] } })
}

function zip(files: Record<string, string>) {
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])))
  return { ok: true, status: 200, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }
}

const CONTENT_LIST = JSON.stringify([
  { type: "text", text: "INVOICE 42", page_idx: 0, bbox: [10, 20, 110, 40] },
  { type: "image", img_path: "images/logo.jpg", page_idx: 0, bbox: [0, 0, 50, 50] },
  { type: "table", table_body: "<table><tr><td>Widget</td></tr></table>", page_idx: 1, bbox: [5, 5, 200, 80] },
  { type: "text", text: "Total 99", page_idx: 1, bbox: [120, 300, 200, 320] },
])
const MIDDLE = JSON.stringify({ pdf_info: [{ page_size: [612, 792] }, { page_size: [612, 792] }] })
/** The real archive layout: full.md sits at the root under its plain name while the content
 * list and middle file are prefixed with the document id, alongside a nested `_v2` variant this
 * module ignores. */
const DEFAULT_ZIP = {
  "full.md": "# INVOICE 42\n\nTotal 99",
  "e80c90ac-f61c_content_list.json": CONTENT_LIST,
  "e80c90ac-f61c_content_list_v2.json": JSON.stringify([[{ type: "paragraph", content: { paragraph_content: [{ type: "text", content: "nested format" }] } }]]),
  "e80c90ac-f61c_middle.json": MIDDLE,
  "layout.json": "{}",
}

type Overrides = Partial<{ batch: unknown; upload: unknown; polls: unknown[]; zip: unknown }>

/** Routes the four calls one parse makes (create batch, upload, poll, download) so a test
 * only has to describe the step it cares about. The last poll response is repeated, so a
 * single entry means "done immediately". */
function stubFetch(overrides: Overrides = {}) {
  const polls = [...(overrides.polls ?? [pollBody("done", { full_zip_url: ZIP_URL })])]
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/file-urls/batch")) return overrides.batch ?? json({ code: 0, data: { batch_id: "batch-1", file_urls: [UPLOAD_URL] } })
    if (url === UPLOAD_URL) return overrides.upload ?? { ok: true, status: 200, text: async () => "" }
    if (url.includes("/extract-results/batch/")) return polls.length > 1 ? polls.shift() : polls[0]
    return overrides.zip ?? zip(DEFAULT_ZIP)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const parse = (input: Partial<Parameters<typeof parseDocumentWithMineru>[0]> = {}) =>
  parseDocumentWithMineru({ buffer: Buffer.from("%PDF-1.7"), filename: "invoice.pdf", ...input })

beforeEach(() => {
  mineru.apiToken = "test-token"
  mineru.timeoutMs = 5_000
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseDocumentWithMineru", () => {
  it("refuses to send anything when no token is configured", async () => {
    const fetchMock = stubFetch()
    mineru.apiToken = ""
    await expect(parse()).rejects.toThrow("mineru_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("creates the batch with the configured model and the file's name", async () => {
    const fetchMock = stubFetch()
    await parse()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://mineru.test/api/v4/file-urls/batch")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token")
    expect(JSON.parse(init.body as string)).toEqual({
      enable_formula: false,
      enable_table: true,
      language: "auto",
      model_version: "vlm",
      files: [{ name: "invoice.pdf", is_ocr: true }],
    })
  })

  it("passes a page range through to MinerU and omits it when there is none", async () => {
    const withRange = stubFetch()
    await parse({ pageRanges: "1-2,5" })
    expect(JSON.parse((withRange.mock.calls[0][1] as RequestInit).body as string).files[0].page_ranges).toBe("1-2,5")

    const withoutRange = stubFetch()
    await parse({ pageRanges: null })
    expect(JSON.parse((withoutRange.mock.calls[0][1] as RequestInit).body as string).files[0]).not.toHaveProperty("page_ranges")
  })

  /** The presigned URL is signed without a Content-Type; sending one voids the signature. */
  it("PUTs the raw bytes to the presigned URL without a Content-Type", async () => {
    const fetchMock = stubFetch()
    await parse({ buffer: Buffer.from("bytes") })
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(UPLOAD_URL)
    expect(init.method).toBe("PUT")
    expect(init.headers).toBeUndefined()
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe("bytes")
  })

  it("polls until the batch is done, renewing the caller's lease each time", async () => {
    stubFetch({ polls: [pollBody("pending"), pollBody("running"), pollBody("converting"), pollBody("done", { full_zip_url: ZIP_URL })] })
    const onPoll = vi.fn(async () => {})
    const result = await parse({ onPoll })
    expect(onPoll).toHaveBeenCalledTimes(4)
    expect(result.markdown).toBe("# INVOICE 42\n\nTotal 99")
  })

  it("splits the result into pages, renumbering MinerU's 0-based page_idx", async () => {
    stubFetch()
    const result = await parse()
    expect(result.pages).toEqual([
      { page: 1, text: "INVOICE 42" },
      { page: 2, text: "<table><tr><td>Widget</td></tr></table>\n\nTotal 99" },
    ])
  })

  it("returns pages, blocks, and sizes null when the archive carries no flat content list", async () => {
    stubFetch({ zip: zip({ "full.md": "# INVOICE 42", "doc_content_list_v2.json": "[[]]" }) })
    const result = await parse()
    expect(result).toEqual({ markdown: "# INVOICE 42", pages: null, blocks: null, pageSizes: null })
  })

  it("returns per-block bboxes and page sizes alongside the markdown", async () => {
    stubFetch()
    const result = await parse()
    expect(result.blocks).toEqual([
      { page: 1, bbox: [10, 20, 110, 40], text: "INVOICE 42", type: "text" },
      { page: 2, bbox: [5, 5, 200, 80], text: "<table><tr><td>Widget</td></tr></table>", type: "table" },
      { page: 2, bbox: [120, 300, 200, 320], text: "Total 99", type: "text" },
    ])
    expect(result.pageSizes).toEqual([
      { page: 1, width: 612, height: 792 },
      { page: 2, width: 612, height: 792 },
    ])
  })

  it("degrades page sizes to null when middle.json is absent", async () => {
    stubFetch({ zip: zip({ "full.md": "# INVOICE 42", "doc_content_list.json": CONTENT_LIST }) })
    const result = await parse()
    expect(result.blocks).toHaveLength(3)
    expect(result.pageSizes).toBeNull()
  })

  it("finds outputs nested under a directory", async () => {
    stubFetch({ zip: zip({ "invoice/full.md": "# INVOICE 42", "invoice/content_list.json": CONTENT_LIST }) })
    expect((await parse()).pages).toHaveLength(2)
  })

  it("fails when the archive has no markdown", async () => {
    stubFetch({ zip: zip({ "doc_content_list.json": CONTENT_LIST }) })
    await expect(parse()).rejects.toThrow("mineru_empty_result")
  })

  it("fails when the markdown is blank", async () => {
    stubFetch({ zip: zip({ "full.md": "   \n  " }) })
    await expect(parse()).rejects.toThrow("mineru_empty_result")
  })

  it("maps the document-too-large and page-limit codes to permanent errors", async () => {
    stubFetch({ polls: [pollBody("failed", { err_msg: "file size limit exceeded (-60005)" })] })
    await expect(parse()).rejects.toThrow("mineru_file_too_large")

    stubFetch({ polls: [pollBody("failed", { err_msg: "page limit exceeded (-60006)" })] })
    await expect(parse()).rejects.toThrow("mineru_page_limit_exceeded")
  })

  it("maps a parse failure, a non-zero response code, and an HTTP error to a retryable failure", async () => {
    stubFetch({ polls: [pollBody("failed", { err_msg: "parse failed (-60010)" })] })
    await expect(parse()).rejects.toThrow("mineru_parse_failed")

    stubFetch({ batch: json({ code: -10001, msg: "token expired" }) })
    await expect(parse()).rejects.toThrow("mineru_parse_failed")

    stubFetch({ batch: json({ msg: "boom" }, { ok: false, status: 500 }) })
    await expect(parse()).rejects.toThrow("mineru_parse_failed")
  })

  /** A rejected signature is settled — retrying it only delays the job's own retry. */
  it("does not retry an upload the object store refused", async () => {
    const fetchMock = stubFetch({ upload: { ok: false, status: 403, text: async () => "SignatureDoesNotMatch" } })
    await expect(parse()).rejects.toThrow("mineru_upload_failed")
    expect(fetchMock.mock.calls.filter(([url]) => url === UPLOAD_URL)).toHaveLength(1)
  })

  it("retries a connect timeout before giving up on the upload", async () => {
    let attempts = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === UPLOAD_URL) {
        attempts++
        throw new Error("fetch failed")
      }
      return json({ code: 0, data: { batch_id: "batch-1", file_urls: [UPLOAD_URL] } })
    }))
    await expect(parse()).rejects.toThrow("mineru_upload_failed")
    expect(attempts).toBe(3)
  })

  it("carries on when a flaky upload succeeds on a later attempt", async () => {
    let attempts = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/file-urls/batch")) return json({ code: 0, data: { batch_id: "batch-1", file_urls: [UPLOAD_URL] } })
      if (url === UPLOAD_URL) return ++attempts < 2 ? Promise.reject(new Error("Connect Timeout Error")) : { ok: true, status: 200 }
      if (url.includes("/extract-results/batch/")) return pollBody("done", { full_zip_url: ZIP_URL })
      return zip(DEFAULT_ZIP)
    }))
    expect((await parse()).markdown).toBe("# INVOICE 42\n\nTotal 99")
    expect(attempts).toBe(2)
  })

  /** The failure that motivated this: one dropped poll used to throw away a parse MinerU had
   * already run and charged to the account's page quota. */
  it("survives a dropped poll request mid-parse", async () => {
    let polls = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/file-urls/batch")) return json({ code: 0, data: { batch_id: "batch-1", file_urls: [UPLOAD_URL] } })
      if (url === UPLOAD_URL) return { ok: true, status: 200 }
      if (url.includes("/extract-results/batch/")) {
        if (++polls === 1) throw new Error("fetch failed")
        return pollBody("done", { full_zip_url: ZIP_URL })
      }
      return zip(DEFAULT_ZIP)
    }))
    expect((await parse()).pages).toHaveLength(2)
  })

  it("retries a dropped result download", async () => {
    let downloads = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/file-urls/batch")) return json({ code: 0, data: { batch_id: "batch-1", file_urls: [UPLOAD_URL] } })
      if (url === UPLOAD_URL) return { ok: true, status: 200 }
      if (url.includes("/extract-results/batch/")) return pollBody("done", { full_zip_url: ZIP_URL })
      if (++downloads === 1) throw new Error("fetch failed")
      return zip(DEFAULT_ZIP)
    }))
    expect((await parse()).markdown).toBe("# INVOICE 42\n\nTotal 99")
    expect(downloads).toBe(2)
  })

  it("gives up once the deadline passes", async () => {
    stubFetch({ polls: [pollBody("running")] })
    mineru.timeoutMs = 1
    await expect(parse()).rejects.toThrow("mineru_timeout")
  })
})

describe("splitPagesFromContentList", () => {
  it("joins a page's blocks in order and skips images", () => {
    const pages = splitPagesFromContentList(JSON.stringify([
      { type: "text", text: "Header", page_idx: 0 },
      { type: "image", img_path: "images/a.jpg", page_idx: 0 },
      { type: "equation", text: "$x = 1$", page_idx: 0 },
    ]))
    expect(pages).toEqual([{ page: 1, text: "Header\n\n$x = 1$" }])
  })

  it("keeps pages sorted even when blocks arrive out of order", () => {
    const pages = splitPagesFromContentList(JSON.stringify([
      { type: "text", text: "second", page_idx: 1 },
      { type: "text", text: "first", page_idx: 0 },
    ]))
    expect(pages!.map((page) => page.page)).toEqual([1, 2])
  })

  it("returns null for missing, unparseable, or empty content", () => {
    expect(splitPagesFromContentList(null)).toBeNull()
    expect(splitPagesFromContentList("not json")).toBeNull()
    expect(splitPagesFromContentList('{"blocks": []}')).toBeNull()
    expect(splitPagesFromContentList("[]")).toBeNull()
    expect(splitPagesFromContentList(JSON.stringify([{ type: "text", text: "  ", page_idx: 0 }]))).toBeNull()
  })

  it("drops blocks with an unusable page index", () => {
    expect(splitPagesFromContentList(JSON.stringify([{ type: "text", text: "x", page_idx: -1 }, { type: "text", text: "y", page_idx: "2" }]))).toBeNull()
  })
})

describe("parseBlocksFromContentList", () => {
  it("keeps each readable block with its page and validated bbox", () => {
    const blocks = parseBlocksFromContentList(JSON.stringify([
      { type: "text", text: "Header", page_idx: 0, bbox: [1, 2, 3, 4] },
      { type: "table", table_body: "<table></table>", text: "fallback", page_idx: 1, bbox: [0, 0, 10, 10] },
    ]))
    expect(blocks).toEqual([
      { page: 1, bbox: [1, 2, 3, 4], text: "Header", type: "text" },
      { page: 2, bbox: [0, 0, 10, 10], text: "<table></table>", type: "table" },
    ])
  })

  it("prefers table_body but falls back to text when it is missing", () => {
    const blocks = parseBlocksFromContentList(JSON.stringify([{ type: "table", text: "just text", page_idx: 0 }]))
    expect(blocks).toEqual([{ page: 1, bbox: null, text: "just text", type: "table" }])
  })

  it("drops images and nulls out unusable bboxes", () => {
    const blocks = parseBlocksFromContentList(JSON.stringify([
      { type: "image", img_path: "a.jpg", page_idx: 0, bbox: [0, 0, 5, 5] },
      { type: "text", text: "three numbers", page_idx: 0, bbox: [1, 2, 3] },
      { type: "text", text: "not a number", page_idx: 0, bbox: [1, 2, "x", 4] },
      { type: "text", text: "zero area", page_idx: 0, bbox: [5, 5, 5, 9] },
      { type: "text", text: "no bbox key", page_idx: 0 },
    ]))
    expect(blocks).toEqual([
      { page: 1, bbox: null, text: "three numbers", type: "text" },
      { page: 1, bbox: null, text: "not a number", type: "text" },
      { page: 1, bbox: null, text: "zero area", type: "text" },
      { page: 1, bbox: null, text: "no bbox key", type: "text" },
    ])
  })

  it("returns null for missing, unparseable, or empty content", () => {
    expect(parseBlocksFromContentList(null)).toBeNull()
    expect(parseBlocksFromContentList("not json")).toBeNull()
    expect(parseBlocksFromContentList("[]")).toBeNull()
    expect(parseBlocksFromContentList(JSON.stringify([{ type: "image", img_path: "a.jpg", page_idx: 0 }]))).toBeNull()
  })
})

describe("parsePageSizesFromMiddle", () => {
  it("reads page_size per page, numbering from 1", () => {
    const sizes = parsePageSizesFromMiddle(JSON.stringify({ pdf_info: [{ page_size: [612, 792] }, { page_size: [595, 842] }] }))
    expect(sizes).toEqual([
      { page: 1, width: 612, height: 792 },
      { page: 2, width: 595, height: 842 },
    ])
  })

  it("skips pages with a malformed size but keeps the page numbering aligned", () => {
    const sizes = parsePageSizesFromMiddle(JSON.stringify({ pdf_info: [{ page_size: [612, 792] }, { page_size: [0, 100] }, { page_size: [100, 200] }] }))
    expect(sizes).toEqual([
      { page: 1, width: 612, height: 792 },
      { page: 3, width: 100, height: 200 },
    ])
  })

  it("returns null for missing, unparseable, or shapeless content", () => {
    expect(parsePageSizesFromMiddle(null)).toBeNull()
    expect(parsePageSizesFromMiddle("not json")).toBeNull()
    expect(parsePageSizesFromMiddle("{}")).toBeNull()
    expect(parsePageSizesFromMiddle(JSON.stringify({ pdf_info: [{ page_size: [612] }] }))).toBeNull()
  })
})
