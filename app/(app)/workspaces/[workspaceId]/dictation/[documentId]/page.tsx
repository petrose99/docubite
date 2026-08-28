import { DictationWorkspace } from "@/components/dictation/dictation-workspace"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { DICTATION_FORMATS } from "@/lib/dictation/formats"
import { parseDictationRoutingRecord } from "@/lib/dictation/pipeline"
import { parseTemplateFields } from "@/lib/document-templates"
import type { AudioProvenance } from "@/lib/provenance-audio"
import type { AsrSegment } from "@/lib/asr/types"
import type { CompletenessReport } from "@/lib/report-completeness"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { getDocumentsStatus } from "@/models/documents"
import { listPendingFieldSuggestions } from "@/models/field-suggestions"
import { findReportTemplate } from "@/models/report-drafts"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** The verify screen: audio, transcript, fields and report, side by side.
 *
 * Everything a pathologist needs to answer "is this actually what I said" is on one screen, because
 * that check is the whole point of the feature — a transcript they cannot compare against the audio
 * is a transcript they have to take on trust. */
export default async function DictationDetailPage({ params }: { params: Promise<{ workspaceId: string; documentId: string }> }) {
  const { workspaceId, documentId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!config.asr.enabled || membership.workspace.industry !== "healthcare") notFound()

  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId, source: "dictation" },
    include: {
      template: { select: { name: true, code: true } },
      transcriptEditedBy: { select: { name: true, email: true } },
      reportDrafts: {
        orderBy: { version: "desc" },
        include: { signedBy: { select: { name: true, email: true } } },
      },
    },
  })
  if (!document) notFound()

  const fields = parseTemplateFields(document.fieldSnapshot)
  const values = (document.reviewedData ?? document.rawExtraction ?? {}) as Record<string, unknown>
  const confidence = (document.confidence ?? {}) as { fieldConfidence?: Record<string, number>; missingRequiredFields?: string[]; unsupportedFields?: string[] }
  const provenance = (document.provenance ?? null) as AudioProvenance | null
  const segments = (Array.isArray(document.transcript) ? document.transcript : []) as unknown as AsrSegment[]

  // Which narrative sections the report will have, so the draft pane can label them before a draft
  // exists. A workspace that has somehow lost its report template gets an explicit message rather
  // than a Draft button that fails on press.
  const specimenType = typeof values.specimen_type === "string" ? values.specimen_type : null
  const reportTemplate = await findReportTemplate(workspaceId, specimenType)
  const sections = reportTemplate ? parseNarrativeSections(reportTemplate.narrativeSections) : []

  const latest = document.reportDrafts[0]
  const fieldSuggestions = await listPendingFieldSuggestions(workspaceId, documentId)
  const [indexStatus] = config.embeddings.enabled ? await getDocumentsStatus(workspaceId, [documentId]) : []

  return (
    <DictationWorkspace
      workspaceId={workspaceId}
      documentSearchEnabled={config.embeddings.enabled}
      indexing={indexStatus?.indexing ?? false}
      searchable={indexStatus?.searchable ?? false}
      document={{
        id: document.id,
        filename: document.filename,
        suggestedTitle: document.suggestedTitle,
        status: document.status,
        errorCode: document.errorCode,
        mimeType: document.mimeType,
        receivedAt: document.receivedAt.toISOString(),
        templateName: document.template?.name ?? "Dictation",
        transcript: document.ocrText,
        transcriptModel: document.transcriptModel,
        segments,
        transcriptEditedAt: document.transcriptEditedAt?.toISOString() ?? null,
        transcriptEditedBy: document.transcriptEditedBy?.name || document.transcriptEditedBy?.email || null,
        dictationRouting: parseDictationRoutingRecord(document.dictationRouting),
      }}
      fields={fields}
      values={values}
      fieldConfidence={confidence.fieldConfidence ?? {}}
      missingRequiredFields={confidence.missingRequiredFields ?? []}
      unsupportedFields={confidence.unsupportedFields ?? []}
      provenance={provenance}
      reportTemplateName={reportTemplate?.name ?? null}
      sections={sections.map((section) => ({ key: section.key, title: section.title }))}
      draft={latest
        ? {
            id: latest.id,
            version: latest.version,
            status: latest.status,
            renderedText: latest.renderedText,
            narrative: (latest.narrative ?? {}) as Record<string, string>,
            completeness: latest.missingFields as unknown as CompletenessReport,
            signedAt: latest.signedAt?.toISOString() ?? null,
            signedBy: latest.signedBy?.name || latest.signedBy?.email || null,
          }
        : null}
      draftHistory={document.reportDrafts.map((entry) => ({
        id: entry.id,
        version: entry.version,
        status: entry.status,
        signedAt: entry.signedAt?.toISOString() ?? null,
      }))}
      fieldSuggestions={fieldSuggestions.map((suggestion) => ({
        id: suggestion.id,
        key: suggestion.key,
        label: suggestion.label,
        type: suggestion.type,
        instruction: suggestion.instruction,
        value: suggestion.value,
        quote: suggestion.quote,
        confidence: suggestion.confidence,
      }))}
      availableFormats={DICTATION_FORMATS.map((format) => ({ name: format.name, label: format.label }))}
    />
  )
}
