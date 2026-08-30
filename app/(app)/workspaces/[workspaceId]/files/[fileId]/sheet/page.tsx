import { SheetView } from "@/components/sheet/sheet-view"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { getWorkspaceFile } from "@/models/files"
import { ensureFileWorkbook } from "@/models/spreadsheets"
import { requireWorkspaceRole } from "@/models/workspaces"
import type { IWorkbookData } from "@univerjs/presets"
import { notFound } from "next/navigation"

/** Parses the open-at-page deep-link params (`?doc=&page=&bb=`) the Files content search builds,
 * with every field validated: `page` a positive integer, `bb` exactly four floats in 0-1 space.
 * Returns null on absent or malformed input, so a hand-edited link is silently ignored rather than
 * throwing. The document is authorised separately, against this file and workspace. */
function parseSourceParams(query: { doc?: string; page?: string; bb?: string }): { doc: string; page: number | null; bbox: [number, number, number, number] | null } | null {
  if (!query.doc) return null
  const page = query.page && /^\d+$/.test(query.page) ? Number(query.page) : null
  let bbox: [number, number, number, number] | null = null
  if (query.bb) {
    const parts = query.bb.split(",").map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) bbox = parts as [number, number, number, number]
  }
  return { doc: query.doc, page, bbox }
}

/** The Lido-style spreadsheet workspace, scoped to one file: a file bar on top and the grid
 * filling everything below it. Purely for viewing and editing rows that already landed —
 * uploading and extraction happen on Home/Files or the file's own hub page instead. */
export default async function SheetPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; fileId: string }>
  searchParams: Promise<{ doc?: string; page?: string; bb?: string }>
}) {
  const [{ workspaceId, fileId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) notFound()

  // The deep link's document must belong to this file and workspace, or the source param is dropped.
  const sourceParams = parseSourceParams(query)
  const initialSource = sourceParams
    && (await prisma.document.findFirst({ where: { id: sourceParams.doc, workspaceId, fileId }, select: { id: true } }))
    ? { documentId: sourceParams.doc, page: sourceParams.page, bbox: sourceParams.bbox }
    : undefined

  // The workbook is brought up to date with extraction before it is handed to the client, so a
  // file whose documents were extracted while nothing was watching still opens with its rows.
  const workbook = await ensureFileWorkbook(workspaceId, fileId)

  const [documentCount, queued] = await Promise.all([
    prisma.document.count({ where: { fileId } }),
    prisma.document.findMany({ where: { fileId, status: { in: ["received", "queued", "processing"] } }, select: { id: true }, take: 100 }),
  ])

  return <SheetView
    workspaceId={workspaceId}
    fileId={fileId}
    fileName={file.name}
    linkAccess={file.linkAccess}
    snapshot={(workbook?.snapshot as IWorkbookData | undefined) ?? null}
    rev={workbook?.rev ?? 0}
    queuedIds={queued.map((document) => document.id)}
    hasRows={documentCount > 0}
    documentSearchEnabled={config.embeddings.enabled}
    initialSource={initialSource} />
}
