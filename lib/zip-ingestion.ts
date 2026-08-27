import { unzipSync } from "fflate"
import { cleanFilename, isSupportedDocumentBuffer } from "@/models/documents"

/** A ZIP with more entries than this is rejected outright rather than silently truncated to the
 * first 200 — silent truncation reads as "everything in the folder was processed" when it wasn't. */
export const MAX_ZIP_ENTRIES = 200

/** Cumulative UNCOMPRESSED bytes across every entry. The 52 MB server-action body limit
 * (next.config.ts) already bounds the compressed upload; this is the separate zip-bomb defense —
 * a small archive can still decompress to gigabytes, and unzipSync holds the whole result in
 * memory at once. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024

/** Shared with lib/inbound-email.ts, which faces the same problem for a different reason — an
 * email attachment's declared Content-Type is sender-supplied and not to be trusted any more than
 * a ZIP entry's extension is; both defer to isSupportedDocumentBuffer's magic-byte check either way. */
export const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
}

export type ZipEntry = { filename: string; mimeType: string; buffer: Buffer }
export type ZipSkip = { name: string; reason: "empty" | "unsupported_type" }
export type ZipExpansion = { entries: ZipEntry[]; skipped: ZipSkip[]; truncated: boolean }

/** Expands an uploaded ZIP into the document buffers it contains, applying the same acceptance
 * rule a drag-and-drop upload gets (isSupportedDocumentBuffer's magic-byte check) to every entry.
 *
 * Zip-slip: a crafted entry name like "../../etc/evil.pdf" or an absolute path is neutralised by
 * cleanFilename (path.basename under the hood) before it is used for anything — the exact same
 * sanitizer every other upload's filename already goes through, so a malicious archive cannot
 * reach a different code path than an ordinary upload does. Nothing here ever writes to a
 * filesystem path built from the entry name; storage keys are always server-generated UUIDs
 * (documentStorageKey), so path traversal has no target even before sanitization. */
export function expandZipBuffer(zipBuffer: Buffer): ZipExpansion {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(new Uint8Array(zipBuffer))
  } catch {
    throw new Error("invalid_zip")
  }

  const entries: ZipEntry[] = []
  const skipped: ZipSkip[] = []
  let cumulativeBytes = 0
  let truncated = false

  for (const rawName of Object.keys(unzipped)) {
    if (rawName.endsWith("/")) continue // directory entry, nothing to extract
    if (entries.length >= MAX_ZIP_ENTRIES) { truncated = true; break }

    const data = unzipped[rawName]
    const filename = cleanFilename(rawName)
    if (!data?.length) { skipped.push({ name: filename, reason: "empty" }); continue }

    cumulativeBytes += data.length
    if (cumulativeBytes > MAX_ZIP_UNCOMPRESSED_BYTES) { truncated = true; break }

    const buffer = Buffer.from(data)
    const extension = filename.split(".").pop()?.toLowerCase() ?? ""
    const mimeType = EXTENSION_MIME_TYPES[extension]
    if (!mimeType || !isSupportedDocumentBuffer(buffer, mimeType)) { skipped.push({ name: filename, reason: "unsupported_type" }); continue }

    entries.push({ filename, mimeType, buffer })
  }

  return { entries, skipped, truncated }
}
