import { prisma } from "@/lib/db"
import type { ShapeSignature } from "@/lib/shape-match"
import { Prisma } from "@/prisma/client"

/** Creates or refreshes the shape for a worksheet after it extracts a document, keyed on the
 * worksheet (one shape per worksheet). Refreshes the signature and setup to the latest document
 * and bumps the use count, so matching always compares against the most recent example. */
export async function upsertExtractionShape(input: {
  workspaceId: string
  templateId: string
  name: string
  docType: string | null
  entity: string | null
  fields: Prisma.InputJsonValue
  prompt: string | null
  multiRow: boolean
  signature: ShapeSignature
  lastDocumentId: string
}) {
  const shared = {
    name: input.name,
    docType: input.docType,
    entity: input.entity,
    fields: input.fields,
    prompt: input.prompt,
    multiRow: input.multiRow,
    signature: input.signature as unknown as Prisma.InputJsonValue,
    lastDocumentId: input.lastDocumentId,
  }
  return prisma.extractionShape.upsert({
    where: { templateId: input.templateId },
    create: { workspaceId: input.workspaceId, templateId: input.templateId, useCount: 1, ...shared },
    update: { ...shared, useCount: { increment: 1 } },
  })
}

export type ShapeMatchCandidate = {
  id: string
  name: string
  docType: string | null
  entity: string | null
  fields: unknown
  prompt: string | null
  multiRow: boolean
  signature: ShapeSignature
  lastDocumentId: string | null
  updatedAt: Date
}

/** The workspace's most recent shapes, for matching an incoming upload against. Capped because a
 * probe only needs the recent library, not every shape ever saved. */
export async function listShapesForMatch(workspaceId: string, limit = 50): Promise<ShapeMatchCandidate[]> {
  const shapes = await prisma.extractionShape.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, name: true, docType: true, entity: true, fields: true, prompt: true, multiRow: true, signature: true, lastDocumentId: true, updatedAt: true },
  })
  return shapes.map((shape) => ({ ...shape, signature: shape.signature as unknown as ShapeSignature }))
}
