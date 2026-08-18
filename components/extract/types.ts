import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { DuplicatePair } from "@/lib/dedupe"
import type { Issue } from "@/lib/gap-report"

/** The extraction sheet the panel edits: the selected template flattened to what the client
 * needs, or null when the user is creating a brand-new sheet. */
export type SheetTemplate = { id: string; code: string; name: string; multiRow: boolean; documentCount: number; fields: DocumentFieldDefinition[]; prompt: string }

export type WorkspaceUsage = { planName: string; documentsUsed: number; documentsLimit: number; aiUsed: number; aiLimit: number }

/** A saved extraction shape the incoming upload was matched to, offered as "same as last time?".
 * Carries the setup to re-apply plus the labels for the callout copy. */
export type MatchedShape = { id: string; name: string; docType: string; entity: string; fields: DocumentFieldDefinition[]; prompt: string; multiRow: boolean; lastRunAt: string; lastFilename: string | null }

/** What the suggestion action returns: either a matched shape (no LLM was called) or a fresh
 * LLM suggestion, never both. A single-column request always comes back as a suggestion. */
export type SuggestResult = { suggestion: import("@/lib/document-suggest").SuggestedSheet | null; matchedShape: MatchedShape | null }

/** One kind of document found in an upload batch: how it was classified, how many there are, the
 * documents themselves, and any months missing from a monthly series. */
export type FolderReportGroup = { key: string; docType: string; entity: string; count: number; documents: { id: string; filename: string; status: string; mimeType: string }[]; gaps: string[] }

/** The deterministic reasoning over one folder upload: what kinds of document it holds, which are
 * duplicates, which months are missing, and which documents have problems. `summary` is filled
 * only when the user asks for an AI summary of these stats. */
export type FolderReport = { settled: number; total: number; groups: FolderReportGroup[]; duplicates: DuplicatePair[]; issues: Issue[]; summary: string | null }

export type StagedFileStatus = "staged" | "uploading" | "queued" | "processing" | "done" | "attention" | "failed" | "duplicate"

/** One row of the panel's Files section: a browser File before upload, a workspace document
 * after. previewUrl is an object URL for staged files and the source route once uploaded. */
export type StagedFile = { localId: string; file: File | null; filename: string; sizeBytes: number; mimeType: string; previewUrl: string | null; documentId: string | null; status: StagedFileStatus; error: string | null; relativePath?: string; searchable?: boolean }
