import { strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { expandZipBuffer, MAX_ZIP_ENTRIES } from "@/lib/zip-ingestion"

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0x20)])
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 0)])

function buildZip(entries: Record<string, Uint8Array>): Buffer {
  const archive = zipSync(entries)
  return Buffer.from(archive)
}

describe("expandZipBuffer", () => {
  it("extracts every supported entry with its inferred mime type", () => {
    const zip = buildZip({ "invoice.pdf": new Uint8Array(PDF_BYTES), "receipt.png": new Uint8Array(PNG_BYTES) })
    const { entries, skipped, truncated } = expandZipBuffer(zip)
    expect(entries.map((e) => e.filename).sort()).toEqual(["invoice.pdf", "receipt.png"])
    expect(entries.find((e) => e.filename === "invoice.pdf")?.mimeType).toBe("application/pdf")
    expect(skipped).toEqual([])
    expect(truncated).toBe(false)
  })

  it("skips directory entries without treating them as files", () => {
    const zip = buildZip({ "folder/": new Uint8Array(0), "folder/invoice.pdf": new Uint8Array(PDF_BYTES) })
    const { entries } = expandZipBuffer(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0].filename).toBe("invoice.pdf")
  })

  it("neutralises a zip-slip path traversal entry to its basename", () => {
    const zip = buildZip({ "../../../../etc/evil.pdf": new Uint8Array(PDF_BYTES) })
    const { entries } = expandZipBuffer(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0].filename).toBe("evil.pdf")
    expect(entries[0].filename).not.toContain("..")
    expect(entries[0].filename).not.toContain("/")
  })

  it("neutralises an absolute-path entry the same way", () => {
    const zip = buildZip({ "/etc/passwd.pdf": new Uint8Array(PDF_BYTES) })
    const { entries } = expandZipBuffer(zip)
    expect(entries[0].filename).toBe("passwd.pdf")
  })

  it("skips an entry whose extension or content doesn't match a supported document type", () => {
    const zip = buildZip({ "notes.txt": strToU8("hello"), "fake.pdf": strToU8("not actually a pdf") })
    const { entries, skipped } = expandZipBuffer(zip)
    expect(entries).toEqual([])
    expect(skipped.map((s) => s.reason)).toEqual(["unsupported_type", "unsupported_type"])
  })

  it("skips an empty entry", () => {
    const zip = buildZip({ "empty.pdf": new Uint8Array(0) })
    const { entries, skipped } = expandZipBuffer(zip)
    expect(entries).toEqual([])
    expect(skipped).toEqual([{ name: "empty.pdf", reason: "empty" }])
  })

  it("caps the number of entries rather than processing an unbounded archive", () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < MAX_ZIP_ENTRIES + 20; i++) files[`doc-${i}.pdf`] = new Uint8Array(PDF_BYTES)
    const zip = buildZip(files)
    const { entries, truncated } = expandZipBuffer(zip)
    expect(entries.length).toBe(MAX_ZIP_ENTRIES)
    expect(truncated).toBe(true)
  })

  it("throws on a buffer that isn't a valid zip", () => {
    expect(() => expandZipBuffer(Buffer.from("not a zip"))).toThrow("invalid_zip")
  })
})
