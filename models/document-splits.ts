import { prisma } from "@/lib/db"
import { randomUUID } from "crypto"

export type SplitProposal = {
  parentDocumentId: string
  segments: { startPage: number; endPage: number; confidence: number; reason: string }[]
}

export type ChildDocumentInput = {
  parentDocumentId: string
  pageRange: string
  filename: string
}

export async function createChildDocuments(
  workspaceId: string,
  fileId: string,
  parentDocumentId: string,
  children: ChildDocumentInput[],
): Promise<string[]> {
  const parent = await prisma.document.findUniqueOrThrow({
    where: { id: parentDocumentId },
    select: {
      source: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      storageKey: true,
      templateId: true,
      templateVersionId: true,
    },
  })

  const ids: string[] = []
  for (const child of children) {
    const id = randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parentDocumentId/splitStatus added by migration, types after db:generate
    await (prisma.document.create as any)({
      data: {
        id,
        workspaceId,
        fileId,
        source: parent.source,
        status: "received",
        filename: child.filename,
        mimeType: parent.mimeType,
        sizeBytes: parent.sizeBytes,
        sha256: parent.sha256,
        storageKey: parent.storageKey,
        templateId: parent.templateId,
        templateVersionId: parent.templateVersionId,
        pageRange: child.pageRange,
        parentDocumentId: child.parentDocumentId,
        fieldSnapshot: {},
      },
    })
    ids.push(id)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types after db:generate
  await (prisma.document.update as any)({
    where: { id: parentDocumentId },
    data: { splitStatus: "split" },
  })

  return ids
}

export async function listChildDocuments(parentDocumentId: string): Promise<{ id: string; filename: string; pageRange: string | null; status: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types after db:generate
  return await (prisma.document.findMany as any)({
    where: { parentDocumentId },
    select: { id: true, filename: true, pageRange: true, status: true },
    orderBy: { receivedAt: "asc" },
  })
}

export async function markSplitStatus(documentId: string, status: "pending" | "split" | "rejected"): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types after db:generate
  await (prisma.document.update as any)({
    where: { id: documentId },
    data: { splitStatus: status },
  })
}
