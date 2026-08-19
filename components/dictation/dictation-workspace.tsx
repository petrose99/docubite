"use client"

import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { ReportPane } from "@/components/dictation/report-pane"
import { SynopticForm } from "@/components/dictation/synoptic-form"
import { TranscriptPane } from "@/components/dictation/transcript-pane"
import type { AsrSegment } from "@/lib/asr/types"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { AudioProvenance } from "@/lib/provenance-audio"
import type { CompletenessReport } from "@/lib/report-completeness"
import type { FUniver } from "@univerjs/presets"
import { ArrowLeft, Loader2, Sparkles, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useRef, useState } from "react"

export type DictationDocument = {
  id: string
  filename: string
  status: string
  errorCode: string | null
  mimeType: string
  receivedAt: string
  templateName: string
  transcript: string
  transcriptModel: string | null
  segments: AsrSegment[]
  transcriptEditedAt: string | null
  transcriptEditedBy: string | null
}

export type DictationDraft = {
  id: string
  version: number
  status: string
  renderedText: string
  narrative: Record<string, string>
  completeness: CompletenessReport
  signedAt: string | null
  signedBy: string | null
}

/** The verify screen.
 *
 * Three columns that each answer one question, left to right: what was said, what we made of it,
 * and what will be signed. The transcript stays on screen while you work in the other two, because
 * checking a field against the audio is the task — putting it behind a tab would make the check
 * the thing you have to go looking for. */
export function DictationWorkspace({
  workspaceId, document, fields, values, fieldConfidence, missingRequiredFields, unsupportedFields,
  provenance, draft, draftHistory, sections, reportTemplateName, documentSearchEnabled,
}: {
  workspaceId: string
  document: DictationDocument
  fields: DocumentFieldDefinition[]
  values: Record<string, unknown>
  fieldConfidence: Record<string, number>
  missingRequiredFields: string[]
  unsupportedFields: string[]
  provenance: AudioProvenance | null
  draft: DictationDraft | null
  draftHistory: { id: string; version: number; status: string; signedAt: string | null }[]
  sections: { key: string; title: string }[]
  reportTemplateName: string | null
  documentSearchEnabled: boolean
}) {
  const router = useRouter()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)

  // The assistant is shared with the spreadsheet, where it drives a live Univer grid. There is no
  // grid here, and `surface="dictation"` stops the server registering the tools that would need
  // one — so this ref exists only to satisfy the prop and stays null for the page's whole life.
  const noGrid = useRef<FUniver | null>(null)

  /** Plays the moment a value was said. Shared by every provenance chip in the fields column. */
  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    void audio.play().catch(() => {})
  }, [])

  const transcribing = document.status === "queued" || document.status === "processing"
  const failed = document.status === "failed"
  const signed = draft?.status === "signed"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        <Link
          href={`/workspaces/${workspaceId}/dictation`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900">
          <ArrowLeft className="h-4 w-4" />Dictation
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-stone-900">{document.filename}</h1>
          <p className="truncate text-xs text-stone-500">{document.templateName} · {new Date(document.receivedAt).toLocaleString()}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {transcribing && <span className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</span>}
          {signed && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Signed</span>}
          {documentSearchEnabled && (
            <button
              type="button"
              onClick={() => setAssistantOpen((open) => !open)}
              aria-pressed={assistantOpen}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${assistantOpen ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 text-stone-600 hover:bg-stone-50"}`}>
              <Sparkles className="h-3.5 w-3.5" />Assistant
            </button>
          )}
        </div>
      </header>

      {failed && (
        <p className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          Transcription failed{document.errorCode ? `: ${document.errorCode.replaceAll("_", " ")}` : ""}. The audio is safe — play it below.
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TranscriptPane
          workspaceId={workspaceId}
          document={document}
          audioRef={audioRef}
          transcribing={transcribing}
          readOnly={signed}
          onSaved={() => router.refresh()} />

        <div className="min-w-0 flex-1 overflow-y-auto bg-stone-50/60">
          <div className="mx-auto grid max-w-5xl gap-4 p-4 xl:grid-cols-2">
            <SynopticForm
              workspaceId={workspaceId}
              documentId={document.id}
              fields={fields}
              values={values}
              fieldConfidence={fieldConfidence}
              missingRequiredFields={missingRequiredFields}
              unsupportedFields={unsupportedFields}
              provenance={provenance}
              readOnly={signed}
              transcribing={transcribing}
              onSeek={seekTo} />

            <ReportPane
              workspaceId={workspaceId}
              documentId={document.id}
              draft={draft}
              draftHistory={draftHistory}
              sections={sections}
              reportTemplateName={reportTemplateName}
              transcriptEdited={Boolean(document.transcriptEditedAt)}
              disabled={transcribing || failed} />
          </div>
        </div>

        {assistantOpen && documentSearchEnabled && (
          <AssistantPanel
            workspaceId={workspaceId}
            apiRef={noGrid}
            surface="dictation"
            title="Case assistant"
            className="flex w-80 shrink-0 flex-col border-l bg-stone-50"
            documentSearchEnabled
            emptyHint="Ask about this case or anything else on record. Answers are quoted from the documents, never interpreted."
            intents={[
              "What does this dictation say about the margins?",
              "Have we seen this accession number before?",
              "Find other cases with the same specimen type",
            ]}
            onClose={() => setAssistantOpen(false)} />
        )}
      </div>
    </div>
  )
}
