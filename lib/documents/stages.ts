import type { Prisma } from "@/prisma/client"

/** Canonical Document.status/pipeline-stage vocabulary. `Document.status` is a plain
 * `String @default("received")` (schema.prisma), not a Prisma enum — deliberately, since the
 * public REST API and Zapier persist and match on the raw string values. Keep it that way: this
 * module is a typed const union + mapping helpers over that string, never an enum requiring a
 * data migration. */

/** The persisted Document lifecycle. "received" is the schema default but is never actually
 * observed on a row — createDocumentFromBuffer writes "queued" in the same transaction that
 * creates the document — so it is handled only defensively, by normalizeStatus below. */
export const DOCUMENT_STATUSES = ["queued", "ready_for_review", "needs_review", "reviewed", "failed"] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

/** Terminal statuses: extraction has finished (successfully or not) and nothing async is still
 * writing to the document. Shared by the extraction-progress poller (client) and any server code
 * that needs to know a document is done moving. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ready_for_review", "needs_review", "reviewed", "failed"] satisfies DocumentStatus[])

/** Below this the extraction is a guess worth a second look. Relocated from lib/sheet-seed so
 * document code no longer has to import a sheet library to know the threshold; lib/sheet-seed
 * re-exports it for the sheet's own use. */
export const LOW_CONFIDENCE = 0.6

/** The UI pipeline tabs. Derived from Document.status (+ archive/review-task state), never
 * persisted — "processing" is deliberately not a stage; it is an inline spinner state within
 * Inbox, driven by `hasActiveJob`. */
export const PIPELINE_STAGES = ["inbox", "to_review", "ready", "approvals", "archive"] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_LABELS: Record<PipelineStage, string> = {
  inbox: "Inbox",
  to_review: "To review",
  ready: "Ready",
  approvals: "Approvals",
  archive: "Archive",
}

/** Folds legacy/phantom status values onto the real ones: the schema's "received" default
 * (never actually written) and "extracted" (only ever written to IngestionItem, never to
 * Document — the drift bug lib/finance/inbox.ts used to have) both mean "still queued" for any
 * Document row that happens to carry them. */
export function normalizeStatus(raw: string): DocumentStatus {
  if ((DOCUMENT_STATUSES as readonly string[]).includes(raw)) return raw as DocumentStatus
  if (raw === "received" || raw === "extracted") return "queued"
  return "queued"
}

/** A minimal view of a Document (plus its review-task/archive state) sufficient to place it on a
 * pipeline tab. `archivedAt` is optional because the column does not exist yet (Phase 1 adds it);
 * until then no document is ever archived. */
export type StageableDocument = { status: string; archivedAt?: Date | null }

export type StageContext = {
  /** A queued/processing DocumentProcessingJob exists for this document. */
  hasActiveJob?: boolean
  /** An open or in_review ReviewTask exists for this document. */
  openReviewTask?: boolean
}

/** Maps a document (+ its job/review-task context) onto the tab it belongs on. Archive wins over
 * every other rule: a document can be archived at any point in its lifecycle. */
export function documentStage(doc: StageableDocument, context: StageContext = {}): PipelineStage {
  if (doc.archivedAt != null) return "archive"
  const status = normalizeStatus(doc.status)
  if (status === "failed" || status === "queued") return "inbox"
  if (status === "needs_review" || status === "ready_for_review") return "to_review"
  // status === "reviewed"
  return context.openReviewTask ? "approvals" : "ready"
}

/** The Prisma where-fragment for a stage's document-status set, so the pipeline list and its
 * count query share one definition of each tab. Excludes the archive axis (a boolean column, not
 * a status) and the approvals/ready split (which additionally depends on ReviewTask state) —
 * callers needing those narrow further themselves. */
export function stageToStatusFilter(stage: PipelineStage): Prisma.DocumentWhereInput {
  switch (stage) {
    case "inbox":
      return { status: { in: ["queued", "failed"] } }
    case "to_review":
      return { status: { in: ["needs_review", "ready_for_review"] } }
    case "ready":
    case "approvals":
      return { status: "reviewed" }
    case "archive":
      return {}
  }
}

/** The status set that counts as "reviewed" for reporting purposes (finance inbox, folder
 * reports) — reviewed and ready_for_review, deliberately excluding the phantom "extracted" value
 * that was never actually written to Document.status. */
export const REVIEWED_OR_READY_STATUSES: readonly DocumentStatus[] = ["reviewed", "ready_for_review"]
