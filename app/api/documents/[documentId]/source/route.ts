import { getViewerUser } from "@/lib/auth"
import { readDocumentSource } from "@/lib/document-storage"
import { prisma } from "@/lib/db"
import { canOpen, getFileAccess } from "@/models/files"

/** Serves a document's original source. Authorised through the file rather than the workspace,
 * because the shared-file grid's preview and download controls have to work for a link viewer
 * who is not a member — at exactly the level the file's sharing settings allow. */
export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  const document = await prisma.document.findUnique({ where: { id: documentId } })
  if (!document) return new Response("Not found", { status: 404 })

  const viewer = await getViewerUser()
  const access = await getFileAccess(document.fileId, viewer ? { id: viewer.id, email: viewer.email } : null)
  if (!access || !canOpen(access.access)) return new Response("Not found", { status: 404 })

  if (!document.storageKey) return new Response("Source not available", { status: 410 })
  const body = await readDocumentSource(document.storageKey)
  return new Response(new Uint8Array(body), { headers: { "content-type": document.mimeType, "content-disposition": `inline; filename="${document.filename.replaceAll('"', "")}"`, "cache-control": "private, no-store" } })
}
