import { prisma } from "@/lib/db"
import { randomUUID } from "crypto"

type PlacementInput = {
  id: string; workspaceId: string; fileId: string; documentId: string
  univerSheetId: string; rowStart?: number; rowCount: number; placedById: string; placedAt: Date
}

export async function createPlacements(
  workspaceId: string,
  fileId: string,
  univerSheetId: string,
  documentIds: string[],
  placedById: string,
  rowStart?: number,
) {
  if (documentIds.length === 0) return []

  const now = new Date()
  const data: PlacementInput[] = documentIds.map((documentId, i) => ({
    id: randomUUID(),
    workspaceId,
    fileId,
    documentId,
    univerSheetId,
    rowStart: rowStart != null ? rowStart + i : undefined,
    rowCount: 1,
    placedById,
    placedAt: now,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table created by migration, types available after db:generate
  await (prisma as any).documentSheetPlacement.createMany({
    data,
    skipDuplicates: true,
  })

  return data.map((d) => d.id)
}

export async function listPlacedDocumentIds(fileId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types available after db:generate
  const rows: { documentId: string }[] = await (prisma as any).documentSheetPlacement.findMany({
    where: { fileId },
    select: { documentId: true },
    distinct: ["documentId"],
  })
  return rows.map((r) => r.documentId)
}

export async function countReviewedUnplaced(workspaceId: string): Promise<number> {
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT d.id)::bigint AS count
    FROM documents d
    WHERE d.workspace_id = ${workspaceId}::uuid
      AND d.status = 'reviewed'
      AND d.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sheet_placements p
        WHERE p.document_id = d.id
      )
  `
  return Number(result[0].count)
}
