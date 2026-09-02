"use server"

import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields } from "@/lib/document-templates"
import { deriveSheet, type SheetColumn, type SheetRow } from "@/lib/sheet-derive"
import { listWorkspaceDocuments } from "@/models/documents"
import { createPlacements, listPlacedDocumentIds } from "@/models/document-sheet-placements"
import { touchFile } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"

export type PlaceableDocument = {
  id: string
  filename: string
  templateName: string | null
  receivedAt: string
  alreadyPlaced: boolean
}

export async function listPlaceableDocumentsAction(
  workspaceId: string,
  fileId: string,
  filters?: { query?: string; templateCode?: string; dateFrom?: string; dateTo?: string },
): Promise<PlaceableDocument[]> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const [docs, placedIds] = await Promise.all([
    listWorkspaceDocuments(workspaceId, { stage: "ready" }),
    listPlacedDocumentIds(fileId),
  ])

  const placedSet = new Set(placedIds)
  let filtered = docs

  if (filters?.query) {
    const q = filters.query.toLowerCase()
    filtered = filtered.filter((d) => d.filename.toLowerCase().includes(q))
  }

  return filtered.map((d) => ({
    id: d.id,
    filename: d.filename,
    templateName: d.template?.name ?? null,
    receivedAt: d.receivedAt.toISOString(),
    alreadyPlaced: placedSet.has(d.id),
  }))
}

export type PlacementRows = {
  sheetId: string
  columns: SheetColumn[]
  rows: SheetRow[]
  writeHeader: boolean
}

export async function getPlacementRowsAction(
  workspaceId: string,
  fileId: string,
  univerSheetId: string,
  documentIds: string[],
  existingHeaderLabels: string[],
): Promise<PlacementRows> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const docs = await listWorkspaceDocuments(workspaceId, { documentIds })
  if (docs.length === 0) return { sheetId: univerSheetId, columns: [], rows: [], writeHeader: false }

  const templateMap = new Map<string, typeof docs>()
  for (const doc of docs) {
    const key = doc.template?.id ?? "__none__"
    const list = templateMap.get(key) ?? []
    list.push(doc)
    templateMap.set(key, list)
  }

  const allColumns: SheetColumn[] = []
  const allRows: SheetRow[] = []
  const seenColumnIds = new Set<string>()

  for (const [, groupDocs] of templateMap) {
    const firstDoc = groupDocs[0]
    const template = firstDoc.template
    if (!template) continue
    const version = template.versions?.[0]
    if (!version) continue
    const fields = parseTemplateFields(version.fields)
    const derived = deriveSheet(fields, groupDocs.map((d) => ({
      id: d.id, filename: d.filename, reviewedData: d.reviewedData, rawExtraction: d.rawExtraction, confidence: d.confidence,
    })), { multiRow: template.multiRow })

    for (const col of derived.columns) {
      if (!seenColumnIds.has(col.id)) {
        seenColumnIds.add(col.id)
        allColumns.push(col)
      }
    }
    allRows.push(...derived.rows)
  }

  const existingSet = new Set(existingHeaderLabels.map((l) => l.toLowerCase()))
  const writeHeader = existingHeaderLabels.length === 0

  if (!writeHeader) {
    const newColumns = allColumns.filter((c) => !existingSet.has(c.label.toLowerCase()))
    if (newColumns.length > 0) allColumns.push(...newColumns)
  }

  return { sheetId: univerSheetId, columns: allColumns, rows: allRows, writeHeader }
}

export async function markDocumentsPlacedAction(
  workspaceId: string,
  fileId: string,
  univerSheetId: string,
  documentIds: string[],
): Promise<{ rev: number | null }> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  await createPlacements(workspaceId, fileId, univerSheetId, documentIds, user.id)
  await touchFile(fileId)

  const { prisma } = await import("@/lib/db")
  const workbook = await prisma.spreadsheetWorkbook.findUnique({ where: { fileId }, select: { rev: true } })
  return { rev: workbook?.rev ?? null }
}
