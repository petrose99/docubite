import { recordDocumentAudit } from "@/lib/audit"
import { getViewerUser } from "@/lib/auth"
import { diffSnapshotsForWriteback, type WritebackChange } from "@/lib/sheet-writeback"
import { getWorkspaceDocument, updateDocumentField } from "@/models/documents"
import { canEdit, getFileAccess, touchFile } from "@/models/files"
import { getWorkbook, MAX_SNAPSHOT_BYTES, saveWorkbook, StaleRevisionError, type WorkbookSnapshot } from "@/models/spreadsheets"

/** Applies every writeback change through the same path a person editing the Review panel
 * already goes through (models/documents.ts's updateDocumentField) — so a grid edit gets
 * validation, required-field recompute, confidence=1, provenance-pin clearing, FieldCorrection
 * recording, field-value re-projection and an audit event for free, instead of a second,
 * divergent write path.
 *
 * Grouped and applied per document, each in its own try/catch: one document's edit failing to
 * validate (a hand-typed value that no longer parses as the field's type, say) must not fail the
 * save response, and must not stop any other document's changes from landing. Best-effort by
 * design, same as ensureFileWorkbook's reconciliation. */
async function applyWritebackChanges(workspaceId: string, actorId: string | null, changes: WritebackChange[]): Promise<void> {
  const byDocument = new Map<string, WritebackChange[]>()
  for (const change of changes) {
    const list = byDocument.get(change.documentId)
    if (list) list.push(change)
    else byDocument.set(change.documentId, [change])
  }

  for (const [documentId, documentChanges] of byDocument) {
    try {
      for (const change of documentChanges.filter((c) => c.itemKey === null)) {
        await updateDocumentField({ workspaceId, documentId, fieldKey: change.fieldKey, value: change.newValue, actorId })
      }

      const byArrayKey = new Map<string, WritebackChange[]>()
      for (const change of documentChanges.filter((c) => c.itemKey !== null)) {
        const list = byArrayKey.get(change.fieldKey)
        if (list) list.push(change)
        else byArrayKey.set(change.fieldKey, [change])
      }

      for (const [arrayKey, arrayChanges] of byArrayKey) {
        const document = await getWorkspaceDocument(workspaceId, documentId)
        if (!document) continue
        const current = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
        const items = Array.isArray(current[arrayKey]) ? [...(current[arrayKey] as Record<string, unknown>[])] : []
        for (const change of arrayChanges) {
          if (change.itemIndex === null || !items[change.itemIndex]) continue
          items[change.itemIndex] = { ...items[change.itemIndex], [change.itemKey as string]: change.newValue }
        }
        await updateDocumentField({ workspaceId, documentId, fieldKey: arrayKey, value: items, actorId })
      }
    } catch (error) {
      console.error("[workbook writeback] failed to apply grid edits for document", documentId, error instanceof Error ? error.message : error)
    }
  }
}

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

  // Read before saveWorkbook, not after: this is the pre-image the diff needs, and the rev
  // guard inside saveWorkbook (a scoped updateMany on `rev`) is what makes it authentic — a
  // concurrent save from another tab 409s below and no diff runs against a snapshot that was
  // never actually the one this save replaced.
  const before = await getWorkbook(access.file.workspaceId, fileId)

  try {
    const saved = await saveWorkbook({ workspaceId: access.file.workspaceId, fileId, rev, snapshot: snapshot as WorkbookSnapshot })
    await touchFile(fileId)
    await recordDocumentAudit({ workspaceId: access.file.workspaceId, actorId: viewer?.id ?? null, type: "workbook_saved", detail: { fileId, rev: saved.rev } })

    const changes = diffSnapshotsForWriteback(before?.snapshot ?? {}, saved.snapshot)
    if (changes.length) await applyWritebackChanges(access.file.workspaceId, viewer?.id ?? null, changes)

    return Response.json({ rev: saved.rev, updatedAt: saved.updatedAt })
  } catch (error) {
    // The client reloads on 409 — its in-memory workbook is now a fork of what is stored.
    if (error instanceof StaleRevisionError) return Response.json({ error: "stale_revision", rev: error.currentRev }, { status: 409 })
    throw error
  }
}
