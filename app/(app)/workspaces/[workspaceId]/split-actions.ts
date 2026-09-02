"use server"

import { getCurrentUser } from "@/lib/auth"
import { detectBoundaries, boundariesToPageRanges, type PageSignal } from "@/lib/boundary-detection"
import { createChildDocuments, listChildDocuments, markSplitStatus } from "@/models/document-splits"
import { requireWorkspaceRole } from "@/models/workspaces"

export type SplitSegment = {
  startPage: number
  endPage: number
  pageRange: string
  confidence: number
  reason: string
}

export type SplitProposalResult = {
  documentId: string
  filename: string
  totalPages: number
  segments: SplitSegment[]
}

export async function proposeSplitAction(
  workspaceId: string,
  documentId: string,
  pages: PageSignal[],
): Promise<SplitProposalResult> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const boundaries = detectBoundaries(pages)
  const ranges = boundariesToPageRanges(boundaries)

  return {
    documentId,
    filename: "",
    totalPages: pages.length,
    segments: boundaries.map((b, i) => ({
      startPage: b.startPage,
      endPage: b.endPage,
      pageRange: ranges[i],
      confidence: b.confidence,
      reason: b.reason,
    })),
  }
}

export async function confirmSplitAction(
  workspaceId: string,
  documentId: string,
  fileId: string,
  segments: { pageRange: string; filename: string }[],
): Promise<{ childIds: string[] }> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const childIds = await createChildDocuments(
    workspaceId,
    fileId,
    documentId,
    segments.map((s) => ({
      parentDocumentId: documentId,
      pageRange: s.pageRange,
      filename: s.filename,
    })),
  )

  return { childIds }
}

export async function rejectSplitAction(
  workspaceId: string,
  documentId: string,
): Promise<void> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  await markSplitStatus(documentId, "rejected")
}

export async function listChildDocumentsAction(
  workspaceId: string,
  parentDocumentId: string,
): Promise<{ id: string; filename: string; pageRange: string | null; status: string }[]> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  return listChildDocuments(parentDocumentId)
}
