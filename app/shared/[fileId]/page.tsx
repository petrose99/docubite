import { recordDocumentAudit } from "@/lib/audit"
import { SharedSheet } from "@/components/files/shared-sheet"
import { getViewerUser } from "@/lib/auth"
import config from "@/lib/config"
import { canOpen, getFileAccess } from "@/models/files"
import { ensureFileWorkbook } from "@/models/spreadsheets"
import type { IWorkbookData } from "@univerjs/presets"
import Link from "next/link"
import { notFound } from "next/navigation"

/** Public link route, keyed on the file id itself the way Lido keys on ?lidoFileId=<uuid>.
 *
 * This sits outside proxy.ts's /workspaces/:path* matcher, so there is no session check in
 * front of it — the access resolution below is the only gate, and it has to run for signed-out
 * visitors too. A file at "No access" is indistinguishable from one that does not exist. */
export default async function SharedFilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const [{ fileId }, viewer] = await Promise.all([params, getViewerUser()])
  const resolved = await getFileAccess(fileId, viewer ? { id: viewer.id, email: viewer.email } : null)
  if (!resolved || !canOpen(resolved.access)) {
    // Only recorded when the file exists and access was actually denied — a bare 404 for an
    // unrecognised id has no workspace to attribute the attempt to, honestly recorded as nothing.
    if (resolved) {
      await recordDocumentAudit({
        workspaceId: resolved.file.workspaceId, actorId: viewer?.id ?? null,
        type: "shared_link_opened", outcome: "denied",
      })
    }
    notFound()
  }

  const { file, access } = resolved
  // actorId is honestly null for the common case here: an anonymous link holder. That null is the
  // finding worth recording — see F15/hipaaMode, which is what eventually forces this route to
  // require an authenticated viewer for workspaces that opt in.
  await recordDocumentAudit({ workspaceId: file.workspaceId, actorId: viewer?.id ?? null, type: "shared_link_opened", detail: { fileId: file.id, access } })
  const workbook = await ensureFileWorkbook(file.workspaceId, file.id)

  // "interact" lets a guest try changes on their own copy — the grid stays live but nothing is
  // saved back, which is why it is not treated as edit here.
  const editable = access === "owner" || access === "edit"
  const modeLabel = editable
    ? "You can edit this file"
    : access === "interact"
      ? "You can try changes here — they are not saved to the original file"
      : "You are viewing a read-only copy"

  return <main className="flex min-h-screen flex-col bg-white text-stone-900">
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
      <span className="text-sm font-bold">{config.app.title}</span>
      <span className="truncate text-sm font-semibold text-stone-700" title={file.name}>{file.name}</span>
      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">{modeLabel}</span>
      {access === "owner" && <Link href={`/workspaces/${file.workspaceId}/files/${file.id}/sheet`} className="ml-auto rounded-md border px-2.5 py-1 text-sm font-medium text-stone-700 hover:bg-stone-50">Open in your workspace</Link>}
    </header>

    <SharedSheet
      fileId={file.id}
      snapshot={(workbook?.snapshot as IWorkbookData | undefined) ?? null}
      rev={workbook?.rev ?? 0}
      editable={editable}
      locked={access === "view"} />
  </main>
}

export const dynamic = "force-dynamic"
