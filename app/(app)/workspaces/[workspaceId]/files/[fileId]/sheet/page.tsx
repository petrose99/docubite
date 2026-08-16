import type { SheetTemplate } from "@/components/extract/types"
import { SheetView } from "@/components/sheet/sheet-view"
import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { getFileTemplates, getWorkspaceFile } from "@/models/files"
import { ensureFileWorkbook } from "@/models/spreadsheets"
import { getWorkspaceUsage, requireWorkspaceRole } from "@/models/workspaces"
import type { IWorkbookData } from "@univerjs/presets"
import { notFound } from "next/navigation"

/** The Lido-style spreadsheet workspace, scoped to one file: a file bar on top, the grid
 * filling everything below it, and the Extract Data panel floating over the grid from the
 * button on its Start toolbar. */
export default async function SheetPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; fileId: string }>
  searchParams: Promise<{ template?: string }>
}) {
  const [{ workspaceId, fileId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) notFound()

  // The workbook is brought up to date with extraction before it is handed to the client, so a
  // file whose documents were extracted while nothing was watching still opens with its rows.
  const [templates, usage, workbook] = await Promise.all([
    getFileTemplates(fileId),
    getWorkspaceUsage(workspaceId),
    ensureFileWorkbook(workspaceId, fileId),
  ])

  // Which worksheet the Extract panel configures. `?template=` selects one; otherwise the
  // file's first, which is the tab the grid opens on.
  const selected = templates.find((candidate) => candidate.code === query.template) || templates[0] || null
  const currentVersion = selected?.versions[0]

  const [documentCount, queued] = await Promise.all([
    prisma.document.count({ where: { fileId } }),
    prisma.document.findMany({ where: { fileId, status: { in: ["received", "queued", "processing"] } }, select: { id: true }, take: 100 }),
  ])

  const template: SheetTemplate | null = selected && currentVersion
    ? {
        id: selected.id,
        code: selected.code,
        name: selected.name,
        multiRow: selected.multiRow,
        documentCount,
        fields: parseTemplateFields(currentVersion.fields),
        prompt: currentVersion.prompt || "",
      }
    : null

  return <SheetView
    workspaceId={workspaceId}
    fileId={fileId}
    fileName={file.name}
    linkAccess={file.linkAccess}
    snapshot={(workbook?.snapshot as IWorkbookData | undefined) ?? null}
    rev={workbook?.rev ?? 0}
    template={template}
    usage={usage}
    sheetCount={templates.length}
    queuedIds={queued.map((document) => document.id)}
    hasRows={documentCount > 0} />
}
