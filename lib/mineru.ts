import config from "@/lib/config"
import { strFromU8, unzipSync } from "fflate"

export type MineruPage = { page: number; text: string }
/** One parsed block, kept alongside the flattened page text so a value extracted from a page
 * can later be pinned back to the spot it was printed. `bbox` is MinerU's own [x0,y0,x1,y1] in
 * page pixels — null when the block carried none or an unusable one — and is normalised against
 * the matching page size only when provenance is resolved, never here. */
export type MineruBlock = { page: number; bbox: [number, number, number, number] | null; text: string; type: string }
/** A page's pixel dimensions, read from middle.json. Needed to turn a block's pixel bbox into
 * the resolution-independent 0-1 rectangle the viewer overlays. */
export type MineruPageSize = { page: number; width: number; height: number }
export type MineruParseResult = { markdown: string; pages: MineruPage[] | null; blocks: MineruBlock[] | null; pageSizes: MineruPageSize[] | null }

type ExtractResult = { file_name?: string; state?: string; err_msg?: string; full_zip_url?: string }

/** MinerU reports per-file problems as negative numeric codes. These two mean the document
 * itself is out of bounds and will fail identically on every retry; every other code (parse
 * failures, transport errors) is transient and left retryable. */
const PERMANENT_CODES: Record<string, string> = {
  "-60005": "mineru_file_too_large",
  "-60006": "mineru_page_limit_exceeded",
}

/** Turns whatever MinerU said into an Error whose message becomes the document's errorCode.
 * The detail is searched as text because the code arrives sometimes as the response's `code`
 * field and sometimes embedded in a per-file `err_msg` string. */
function mineruFailure(detail: unknown) {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "")
  const match = Object.entries(PERMANENT_CODES).find(([code]) => text.includes(code))
  return new Error(match ? match[1] : "mineru_parse_failed")
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How many times one request is retried when it fails at the transport level. */
const TRANSPORT_ATTEMPTS = 3

/** Sends one request, retrying only transport failures — DNS, connect timeouts, resets. Both
 * MinerU's API and the object store its presigned URLs point at are a long network hop away,
 * and a single blip there should not throw away a parse that has already been uploaded and
 * charged against the account's page quota. An HTTP response, even an error one, is returned
 * as-is: a 403 on a signature or a 401 on a stale token will not come good on a retry.
 *
 * The reason is logged because a transport failure carries no MinerU code, so it would
 * otherwise reach the operator as a bare `mineru_parse_failed` with nothing to act on. Only
 * the failure is logged, never the document. */
async function fetchWithRetries(url: string, init: RequestInit | undefined, label: string) {
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      console.error(`MinerU ${label} attempt ${attempt}/${TRANSPORT_ATTEMPTS} failed:`, error instanceof Error ? `${error.message}${error.cause ? ` (${error.cause})` : ""}` : error)
      if (attempt < TRANSPORT_ATTEMPTS) await sleep(config.mineru.pollIntervalMs * attempt)
    }
  }
  return null
}

async function mineruFetch(path: string, init?: RequestInit) {
  const response = await fetchWithRetries(`${config.mineru.apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.mineru.apiToken}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  }, `request to ${path}`)
  if (!response) throw new Error("mineru_parse_failed")
  const body = await response.text()
  if (!response.ok) throw mineruFailure(body || `http_${response.status}`)
  let parsed: { code?: number; data?: Record<string, unknown> }
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error("mineru_parse_failed")
  }
  if (parsed.code !== 0) throw mineruFailure(body)
  return parsed.data ?? {}
}

async function createBatch(filename: string, pageRanges?: string | null) {
  const file: Record<string, unknown> = { name: filename, is_ocr: true }
  if (pageRanges) file.page_ranges = pageRanges
  const data = await mineruFetch("/api/v4/file-urls/batch", {
    method: "POST",
    body: JSON.stringify({ enable_formula: false, enable_table: true, language: "auto", model_version: config.mineru.modelVersion, files: [file] }),
  })
  const batchId = data.batch_id
  const uploadUrl = Array.isArray(data.file_urls) ? data.file_urls[0] : undefined
  if (typeof batchId !== "string" || typeof uploadUrl !== "string") throw new Error("mineru_parse_failed")
  return { batchId, uploadUrl }
}

/** The presigned upload URL is signed without a Content-Type, so sending one makes the object
 * store reject the signature. A Uint8Array body is passed rather than a Buffer or Blob
 * precisely because fetch adds no Content-Type of its own for it. */
async function uploadFile(uploadUrl: string, buffer: Buffer) {
  const response = await fetchWithRetries(uploadUrl, { method: "PUT", body: new Uint8Array(buffer) }, "upload")
  if (!response?.ok) throw new Error("mineru_upload_failed")
}

/** Waits for the batch to reach `done`, calling `onPoll` on every iteration so a caller
 * holding a job lease can renew it while MinerU works. */
async function pollBatch(batchId: string, onPoll?: () => Promise<void>) {
  const deadline = Date.now() + config.mineru.timeoutMs
  for (;;) {
    await onPoll?.()
    const data = await mineruFetch(`/api/v4/extract-results/batch/${batchId}`)
    const results = data.extract_result
    const result: ExtractResult = (Array.isArray(results) ? results[0] : null) ?? {}
    if (result.state === "done") {
      if (!result.full_zip_url) throw new Error("mineru_empty_result")
      return result.full_zip_url
    }
    if (result.state === "failed") throw mineruFailure(result.err_msg)
    if (Date.now() >= deadline) throw new Error("mineru_timeout")
    await sleep(config.mineru.pollIntervalMs)
  }
}

async function downloadResult(zipUrl: string) {
  const response = await fetchWithRetries(zipUrl, undefined, "result download")
  if (!response?.ok) throw new Error("mineru_parse_failed")
  return new Uint8Array(await response.arrayBuffer())
}

/** Reads one file out of the result archive. Some outputs sit at the root under their plain
 * name (full.md) and others are prefixed with the batch's document id
 * (`<uuid>_content_list.json`), so both spellings are accepted. Matching the underscore rather
 * than any suffix keeps `_content_list_v2.json` — a different, nested format — from being
 * picked up in place of the flat one this module parses. */
function readEntry(files: Record<string, Uint8Array>, name: string) {
  const key = Object.keys(files).find((entry) => {
    const base = entry.split("/").pop() ?? ""
    return base === name || base.endsWith(`_${name}`)
  })
  return key ? strFromU8(files[key]) : null
}

/** Rebuilds per-page text from content_list.json, whose blocks each carry a 0-based
 * `page_idx`. Image blocks are dropped — only their captions, which arrive as their own text
 * blocks, carry anything the extractor can read. Returns null when the file is missing or
 * malformed, which the caller treats as "one page holding the whole markdown" rather than
 * losing an otherwise good parse over a layout artefact. */
export function splitPagesFromContentList(raw: string | null): MineruPage[] | null {
  if (!raw) return null
  let blocks: unknown
  try {
    blocks = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(blocks)) return null
  const byPage = new Map<number, string[]>()
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue
    const { page_idx: pageIdx, type, text, table_body: tableBody } = block as Record<string, unknown>
    if (typeof pageIdx !== "number" || !Number.isInteger(pageIdx) || pageIdx < 0) continue
    const content = type === "image" ? null : type === "table" ? tableBody ?? text : text
    if (typeof content !== "string" || !content.trim()) continue
    const page = pageIdx + 1
    byPage.set(page, [...(byPage.get(page) ?? []), content.trim()])
  }
  if (!byPage.size) return null
  return [...byPage.entries()].sort(([a], [b]) => a - b).map(([page, parts]) => ({ page, text: parts.join("\n\n") }))
}

/** A bbox is only usable when it is four finite numbers forming a non-empty rectangle. Anything
 * else (missing, wrong length, NaN, zero-area) becomes null, which downgrades that block to a
 * page-level match rather than pointing the highlight at a garbage rectangle. */
function validateBbox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null
  const nums = raw.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN))
  if (nums.some((n) => Number.isNaN(n))) return null
  const [x0, y0, x1, y1] = nums
  if (x1 <= x0 || y1 <= y0) return null
  return [x0, y0, x1, y1]
}

/** Keeps every readable block from content_list.json with its page and bbox, so a matched value
 * can be traced to the block it came from. Mirrors splitPagesFromContentList's block handling —
 * images dropped, tables read from `table_body` — but preserves the per-block structure instead
 * of collapsing it to page text. Returns null when the file is missing or unusable. */
export function parseBlocksFromContentList(raw: string | null): MineruBlock[] | null {
  if (!raw) return null
  let blocks: unknown
  try {
    blocks = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(blocks)) return null
  const result: MineruBlock[] = []
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue
    const { page_idx: pageIdx, type, text, table_body: tableBody, bbox } = block as Record<string, unknown>
    if (typeof pageIdx !== "number" || !Number.isInteger(pageIdx) || pageIdx < 0) continue
    if (type === "image") continue
    const content = type === "table" ? tableBody ?? text : text
    if (typeof content !== "string" || !content.trim()) continue
    result.push({ page: pageIdx + 1, bbox: validateBbox(bbox), text: content.trim(), type: typeof type === "string" ? type : "text" })
  }
  return result.length ? result : null
}

/** Reads each page's pixel dimensions from middle.json's `pdf_info[i].page_size` ([w, h]),
 * numbering pages by array order to match content_list's 0-based page_idx + 1. Returns null when
 * the file is absent or malformed, in which case bboxes cannot be normalised and provenance
 * degrades to a page-level highlight. */
export function parsePageSizesFromMiddle(raw: string | null): MineruPageSize[] | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const pdfInfo = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).pdf_info : null
  if (!Array.isArray(pdfInfo)) return null
  const result: MineruPageSize[] = []
  pdfInfo.forEach((page, index) => {
    const size = page && typeof page === "object" ? (page as Record<string, unknown>).page_size : null
    if (!Array.isArray(size) || size.length !== 2) return
    const [width, height] = size
    if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return
    result.push({ page: index + 1, width, height })
  })
  return result.length ? result : null
}

/** Parses a document with the hosted MinerU API: upload, poll until the batch finishes, then
 * read the markdown out of the result archive. `pageRanges` ("1-3,5") is applied by MinerU
 * itself, so the returned pages are already the selected ones. */
export async function parseDocumentWithMineru(input: { buffer: Buffer; filename: string; pageRanges?: string | null; onPoll?: () => Promise<void> }): Promise<MineruParseResult> {
  if (!config.mineru.apiToken) throw new Error("mineru_not_configured")
  const { batchId, uploadUrl } = await createBatch(input.filename, input.pageRanges)
  await uploadFile(uploadUrl, input.buffer)
  const zipUrl = await pollBatch(batchId, input.onPoll)
  const archive = await downloadResult(zipUrl)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archive)
  } catch {
    throw new Error("mineru_parse_failed")
  }
  const markdown = readEntry(files, "full.md")
  if (!markdown?.trim()) throw new Error("mineru_empty_result")
  const contentList = readEntry(files, "content_list.json")
  return {
    markdown: markdown.trim(),
    pages: splitPagesFromContentList(contentList),
    blocks: parseBlocksFromContentList(contentList),
    pageSizes: parsePageSizesFromMiddle(readEntry(files, "middle.json")),
  }
}
