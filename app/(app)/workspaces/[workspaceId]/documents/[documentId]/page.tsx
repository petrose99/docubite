import { saveDocumentReviewAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { SplitPane } from "@/components/pipeline/document-detail/split-pane"
import { PushToAccountingCard } from "@/components/documents/push-to-accounting-card"
import { MatchPanel } from "@/components/bank-match/match-panel"
import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields } from "@/lib/document-templates"
import type { BlocksSidecar, DocumentProvenance } from "@/lib/provenance"
import { repairMissingBboxes } from "@/lib/provenance"
import { documentBlocksKey, readDocumentBlocks } from "@/lib/document-storage"
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/documents/stages"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listBankMatches } from "@/models/bank-matches"
import { listDocumentAuditEvents } from "@/models/audit-events"
import { getWorkspaceDocument, listWorkspaceDocuments } from "@/models/documents"
import { getOpenReviewTaskForDocument } from "@/models/review-tasks"
import { listWorkspaceIntegrationConnections, listWorkspaceIntegrationPushes } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

/** The pipeline's split-pane document detail: source viewer on the left, tabbed
 * Details/Note/History on the right, provenance-aware field-click highlighting, and prev/next
 * navigation through whatever filtered stage list the reader arrived from (?stage=).
 *
 * Deliberately NOT under the (chrome) route group — that layout's `max-w-4xl` reading-column cap
 * is right for settings pages but leaves no room for a source viewer next to the form. Same URL
 * as before ((chrome) is a route group, so this move doesn't change the path), just outside that
 * layout, so it gets the workspace shell's full-bleed width instead. */
export default async function DocumentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string; documentId: string }>
  searchParams: Promise<{ stage?: string; page?: string; bb?: string }>
}) {
  const { workspaceId, documentId } = await params
  const { stage: stageParam, page: pageParam, bb: bbParam } = await searchParams
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const document = await getWorkspaceDocument(workspaceId, documentId)
  if (!document) notFound()

  const stage: PipelineStage | null = (PIPELINE_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as PipelineStage) : null

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  const canPush = document.status === "reviewed" && capabilities.has("accounting-push")
    && capabilities.pushableTemplateCodes.includes(document.template?.code ?? "")
  const [connections, pushes, auditEvents, neighbors] = await Promise.all([
    canPush ? listWorkspaceIntegrationConnections(workspaceId) : Promise.resolve([]),
    canPush ? listWorkspaceIntegrationPushes(workspaceId, documentId) : Promise.resolve([]),
    listDocumentAuditEvents(workspaceId, documentId),
    stage ? listWorkspaceDocuments(workspaceId, { stage }) : Promise.resolve([]),
  ])

  const fields = parseTemplateFields(document.fieldSnapshot)
  const confidence = document.confidence as { missingRequiredFields?: string[]; fieldConfidence?: Record<string, number>; conflictingFields?: string[] } | null
  const fieldConfidence = confidence?.fieldConfidence || {}
  const conflictingLabels = (confidence?.conflictingFields || []).map((key) => fields.find((field) => field.key === key)?.label || key)
  const data = (document.reviewedData || document.rawExtraction || {}) as Record<string, unknown>
  const rawProvenance = document.provenance as DocumentProvenance | null
  const blocksJson = rawProvenance ? await readDocumentBlocks(documentBlocksKey(workspaceId, documentId)) : null
  const sidecar: BlocksSidecar | null = blocksJson ? (() => { try { return JSON.parse(blocksJson) as BlocksSidecar } catch { return null } })() : null
  const provenance = rawProvenance && sidecar ? repairMissingBboxes(rawProvenance, sidecar, data) : rawProvenance
  const codingData = (document.codingData as Record<string, unknown> | null) ?? {}
  const classification = (document.classification as { docType?: string } | null) ?? {}
  const saveReview = async (formData: FormData) => { "use server"; await saveDocumentReviewAction(workspaceId, documentId, formData) }
  const supplierValue = data.vendor ?? data.merchant
  const supplier = typeof supplierValue === "string" ? supplierValue.trim() : ""
  const canCreateRule = capabilities.has("supplier-rules") && membership.role === "owner" && supplier.length > 0

  const reviewQueueEnabled = capabilities.has("review-queue")
  const openReviewTask = reviewQueueEnabled ? await getOpenReviewTaskForDocument(workspaceId, documentId) : null

  const matchKind = document.template?.code === "bank_statement" && capabilities.has("bank-match") ? "bank" as const
    : document.template?.code === "supplier_statement" && capabilities.has("statement-packs") ? "supplier_statement" as const
    : null
  const bankMatches = matchKind ? await listBankMatches(workspaceId, documentId) : []

  // A content-search result (Files browser, AP-aging chart, pipeline list) links here with an
  // ad-hoc page/bbox — a hit that matched full-text search rather than a named field, so there is
  // no provenance.fields entry to key off. Seeds the viewer's initial highlight the same way a
  // field click would. `bb` is validated the same defensive way the old sheet route's
  // parseSourceParams did: exactly four floats in 0-1 space, since that is the space every field
  // Ref's bbox is normalized into (lib/provenance.ts) — a chunk-level bbox from
  // searchDocumentsByContent (lib/retrieval.ts) is NOT normalized the same way and would otherwise
  // render as a wildly-mispositioned highlight, so an out-of-range value falls back to null
  // (whole-page outline) rather than trusting it.
  const pageNumber = pageParam ? Number(pageParam) : NaN
  const bboxParts = bbParam ? bbParam.split(",").map(Number) : null
  const bbox = bboxParts && bboxParts.length === 4 && bboxParts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ? (bboxParts as [number, number, number, number]) : null
  const initialTarget = Number.isFinite(pageNumber) ? { page: pageNumber, bbox, quote: "" } : null

  const neighborIndex = neighbors.findIndex((doc) => doc.id === documentId)
  const stageQuery = stage ? `?stage=${stage}` : ""
  const prevHref = stage && neighborIndex > 0 ? `/workspaces/${workspaceId}/documents/${neighbors[neighborIndex - 1].id}${stageQuery}` : null
  const nextHref = stage && neighborIndex >= 0 && neighborIndex < neighbors.length - 1 ? `/workspaces/${workspaceId}/documents/${neighbors[neighborIndex + 1].id}${stageQuery}` : null
  // Where a stage-changing action (Archive / Move to Ready) sends the reader next: the following
  // document in the same filtered queue if there is one, otherwise back to the list — mirroring
  // the "advance to the next item" behavior of a review queue, rather than stranding them on a
  // document that no longer belongs on the tab they were just working through.
  const afterActionHref = nextHref ?? (stage ? `/workspaces/${workspaceId}/pipeline?stage=${stage}` : `/workspaces/${workspaceId}/pipeline`)
  const position = stage && neighborIndex >= 0 ? { index: neighborIndex + 1, total: neighbors.length } : null

  return <SplitPane
    workspaceId={workspaceId}
    source={{ documentId: document.id, filename: document.filename, mimeType: document.mimeType }}
    fields={fields}
    data={data}
    fieldConfidence={fieldConfidence}
    provenanceFields={provenance?.fields ?? {}}
    initialTarget={initialTarget}
    conflictingLabels={conflictingLabels}
    missingRequiredFields={confidence?.missingRequiredFields ?? []}
    saveReview={saveReview}
    documentType={(codingData.documentType === "expense" || codingData.documentType === "sale") ? codingData.documentType : null}
    suggestedDocumentType={classification.docType ?? null}
    note={document.note ?? ""}
    auditEvents={auditEvents.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }))}
    prevHref={prevHref}
    nextHref={nextHref}
    position={position}
    stage={stage}
    afterActionHref={afterActionHref}
    header={{
      filename: document.filename, documentId: document.id, fileId: document.fileId, status: document.status,
      flagged: document.flaggedAt !== null,
      reviewLink: reviewQueueEnabled && openReviewTask ? { href: `/workspaces/${workspaceId}/review/${openReviewTask.id}`, label: openReviewTask.status === "in_review" ? "In review" : "Open — view review task" } : null,
    }}
    canPush={canPush}
    pushCard={canPush ? <PushToAccountingCard workspaceId={workspaceId} documentId={documentId} connections={connections} pushes={pushes} /> : null}
    canCreateRule={canCreateRule}
    defaultSupplier={supplier}
    matchKind={matchKind}
    bankMatches={matchKind ? <MatchPanel
      workspaceId={workspaceId}
      statementDocumentId={documentId}
      kind={matchKind}
      matches={bankMatches.map((match) => ({
        id: match.id, transactionIndex: match.transactionIndex, kind: match.kind, confidence: match.confidence,
        dateDeltaDays: match.dateDeltaDays, status: match.status,
        matchedDocument: { id: match.matchedDocument.id, filename: match.matchedDocument.filename },
      }))}
    /> : null}
  />
}
