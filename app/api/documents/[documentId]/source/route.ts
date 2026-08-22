import { recordDocumentAudit } from "@/lib/audit"
import { getViewerUser } from "@/lib/auth"
import { readDocumentSource } from "@/lib/document-storage"
import { prisma } from "@/lib/db"
import { canOpen, getFileAccess } from "@/models/files"

/** Serves a document's original source. Authorised through the file rather than the workspace,
 * because the shared-file grid's preview and download controls have to work for a link viewer
 * who is not a member — at exactly the level the file's sharing settings allow.
 *
 * This is the single highest-value disclosure point in the app: raw source bytes, reachable by an
 * anonymous link holder whenever the file's linkAccess is "view" or stronger. Every outcome —
 * granted or denied — is recorded; a denied attempt is the more interesting of the two. */
export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  const document = await prisma.document.findUnique({ where: { id: documentId } })
  if (!document) return new Response("Not found", { status: 404 })

  const viewer = await getViewerUser()
  const access = await getFileAccess(document.fileId, viewer ? { id: viewer.id, email: viewer.email } : null)
  if (!access || !canOpen(access.access)) {
    await recordDocumentAudit({
      workspaceId: document.workspaceId, documentId: document.id, actorId: viewer?.id ?? null,
      type: "document_viewed", outcome: "denied",
    })
    return new Response("Not found", { status: 404 })
  }

  if (!document.storageKey) return new Response("Source not available", { status: 410 })
  await recordDocumentAudit({
    workspaceId: document.workspaceId, documentId: document.id, actorId: viewer?.id ?? null,
    type: "document_viewed", detail: { access: access.access },
  })
  const body = await readDocumentSource(document.storageKey)
  return new Response(new Uint8Array(body), { headers: { "content-type": document.mimeType, "content-disposition": contentDisposition(document.filename), "cache-control": "private, no-store" } })
}

/** `Headers` values must be ByteStrings (Latin-1) — a filename with any character above code point
 * 255 (an em dash, an accent, non-Latin text) throws at the point of setting the header, not at
 * render time, so this crashed source-of-truth playback outright rather than showing a mangled
 * name. RFC 5987's filename* carries the exact UTF-8 name for browsers that understand it; the
 * plain filename= stays a pure-ASCII fallback (non-ASCII bytes stripped) for anything that doesn't. */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replaceAll('"', "").replace(/[^\x20-\x7e]/g, "_") || "download"
  const encoded = encodeURIComponent(filename.replaceAll('"', ""))
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}
