import { recordDocumentAudit } from "@/lib/audit"
import { getViewerUser } from "@/lib/auth"
import { canEdit, getFileAccess, touchFile } from "@/models/files"
import { MAX_SNAPSHOT_BYTES, saveWorkbook, StaleRevisionError, type WorkbookSnapshot } from "@/models/spreadsheets"

/** Saves the spreadsheet. A route handler rather than a server action because a workbook
 * snapshot is a whole workbook — every tab, cell, formula and style — which routinely exceeds
 * the server-action body limit, and because the stale-revision case wants a real 409.
 *
 * Authorised through the file, like the source route, so a link viewer with edit access can
 * save without being a workspace member. */
export async function POST(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const viewer = await getViewerUser()
  const access = await getFileAccess(fileId, viewer ? { id: viewer.id, email: viewer.email } : null)
  if (!access) return Response.json({ error: "not_found" }, { status: 404 })
  if (!canEdit(access.access)) {
    await recordDocumentAudit({ workspaceId: access.file.workspaceId, actorId: viewer?.id ?? null, type: "workbook_saved", outcome: "denied", detail: { fileId } })
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  const raw = await request.text()
  if (raw.length > MAX_SNAPSHOT_BYTES) return Response.json({ error: "snapshot_too_large" }, { status: 413 })

  let body: { rev?: unknown; snapshot?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }
  const rev = typeof body.rev === "number" && Number.isInteger(body.rev) && body.rev >= 0 ? body.rev : null
  const snapshot = body.snapshot
  if (rev === null || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return Response.json({ error: "invalid_body" }, { status: 400 })

  try {
    const saved = await saveWorkbook({ workspaceId: access.file.workspaceId, fileId, rev, snapshot: snapshot as WorkbookSnapshot })
    await touchFile(fileId)
    await recordDocumentAudit({ workspaceId: access.file.workspaceId, actorId: viewer?.id ?? null, type: "workbook_saved", detail: { fileId, rev: saved.rev } })
    return Response.json({ rev: saved.rev, updatedAt: saved.updatedAt })
  } catch (error) {
    // The client reloads on 409 — its in-memory workbook is now a fork of what is stored.
    if (error instanceof StaleRevisionError) return Response.json({ error: "stale_revision", rev: error.currentRev }, { status: 409 })
    throw error
  }
}
