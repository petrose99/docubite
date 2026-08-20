"use client"

import { renameDictationAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { ReportPane } from "@/components/dictation/report-pane"
import { SuggestedFields, type PendingFieldSuggestion } from "@/components/dictation/suggested-fields"
import { SynopticForm } from "@/components/dictation/synoptic-form"
import { TranscriptPane } from "@/components/dictation/transcript-pane"
import type { AsrSegment } from "@/lib/asr/types"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { AudioProvenance } from "@/lib/provenance-audio"
import type { CompletenessReport } from "@/lib/report-completeness"
import type { FUniver } from "@univerjs/presets"
import { ArrowLeft, Check, FileSearch, Loader2, Pencil, Sparkles, TriangleAlert, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export type DictationDocument = {
  id: string
  filename: string
  suggestedTitle: string | null
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
  provenance, draft, draftHistory, sections, reportTemplateName, documentSearchEnabled, indexing, searchable, fieldSuggestions,
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
  indexing: boolean
  searchable: boolean
  fieldSuggestions: PendingFieldSuggestion[]
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

  // Refreshes server data while the embed job is still in flight, so the Indexing… pill above
  // flips to Searchable on its own rather than needing a manual reload. Stops the moment either
  // flag settles — indexing false or searchable true both end the loop.
  useEffect(() => {
    if (!indexing || searchable) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [indexing, searchable, router])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        <Link
          href={`/workspaces/${workspaceId}/dictation`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900">
          <ArrowLeft className="h-4 w-4" />Dictation
        </Link>
        <div className="min-w-0">
          <DictationTitle workspaceId={workspaceId} documentId={document.id} filename={document.filename} suggestedTitle={document.suggestedTitle} />
          <p className="truncate text-xs text-stone-500">{document.templateName} · {new Date(document.receivedAt).toLocaleString()}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {transcribing && <span className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</span>}
          {!transcribing && documentSearchEnabled && (
            searchable
              ? <span className="flex items-center gap-1.5 text-xs text-stone-400" title="Indexed for document search"><FileSearch className="h-3.5 w-3.5" />Searchable</span>
              : indexing
                ? <span className="flex items-center gap-1.5 text-xs text-stone-400" title="Being indexed for document search"><Loader2 className="h-3.5 w-3.5 animate-spin" />Indexing…</span>
                : null
          )}
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
            {fieldSuggestions.length > 0 && (
              <div className="xl:col-span-2">
                <SuggestedFields workspaceId={workspaceId} documentId={document.id} suggestions={fieldSuggestions} />
              </div>
            )}
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
            title="Assistant"
            className="flex w-80 shrink-0 flex-col border-l bg-stone-50"
            documentSearchEnabled
            emptyHint="Ask about this dictation or anything else on record. Answers are quoted from the documents, never interpreted."
            intents={[
              "Summarize what this dictation says",
              "Have we seen this before?",
              "Find other dictations like this one",
            ]}
            onClose={() => setAssistantOpen(false)} />
        )}
      </div>
    </div>
  )
}

/** The dictation's title, editable in place. Filename is always the source of truth for what's
 * shown — a suggestion is offered as a one-click fill (structureTranscript's discover-mode
 * `_suggested_title`) but never applied automatically, same as every other proposal in this
 * feature: nothing changes until a person acts on it. */
function DictationTitle({ workspaceId, documentId, filename, suggestedTitle }: {
  workspaceId: string
  documentId: string
  filename: string
  suggestedTitle: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(filename)
  const [saving, setSaving] = useState(false)

  const rename = async (title: string) => {
    if (!title.trim() || title.trim() === filename) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const result = await renameDictationAction(workspaceId, documentId, title.trim())
      if (!result.success) {
        toast.error(result.error ?? "Could not rename that dictation")
        return
      }
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void rename(value)
            if (event.key === "Escape") { setValue(filename); setEditing(false) }
          }}
          className="min-w-0 flex-1 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-stone-900 focus:outline-none" />
        <button type="button" disabled={saving} onClick={() => void rename(value)} className="flex h-6 w-6 items-center justify-center rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button type="button" disabled={saving} onClick={() => { setValue(filename); setEditing(false) }} className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-50">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setValue(filename); setEditing(true) }}
        className="group flex min-w-0 items-center gap-1.5 text-left">
        <h1 className="truncate text-sm font-semibold text-stone-900">{filename}</h1>
        <Pencil className="h-3 w-3 shrink-0 text-stone-300 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {suggestedTitle && suggestedTitle !== filename && (
        <button
          type="button"
          onClick={() => void rename(suggestedTitle)}
          className="shrink-0 truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          title={`Use suggested title: ${suggestedTitle}`}>
          Use: {suggestedTitle}
        </button>
      )}
    </div>
  )
}
