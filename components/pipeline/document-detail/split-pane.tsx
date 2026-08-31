"use client"

import { AutomationRuleForm } from "@/components/workspace/automation-rule-form"
import { CreateReviewTaskButton } from "@/components/documents/create-review-task-button"
import { DeleteDocumentButton } from "@/components/documents/delete-document-button"
import { FieldRow } from "@/components/pipeline/document-detail/field-row"
import { LineItemsSection } from "@/components/pipeline/document-detail/line-items-section"
import { archiveDocumentsAction, flagDocumentsAction, moveDocumentsToStageAction, updateDocumentNoteAction } from "@/app/(app)/workspaces/[workspaceId]/pipeline-actions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SourceViewer, type ProvenanceTarget, type SourceDocument } from "@/components/viewer/source-preview"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { PipelineStage } from "@/lib/documents/stages"
import type { Ref } from "@/lib/provenance"
import { Archive, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Flag, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

type Tab = "details" | "note" | "activity"

export function SplitPane({
  workspaceId, source, fields, data, fieldConfidence, provenanceFields, initialTarget, conflictingLabels, missingRequiredFields,
  saveReview, note: initialNote, auditEvents, prevHref, nextHref, position, stage, afterActionHref,
  header, canPush, pushCard, canCreateRule, defaultSupplier, matchKind, bankMatches,
}: {
  workspaceId: string
  source: SourceDocument
  fields: DocumentFieldDefinition[]
  data: Record<string, unknown>
  fieldConfidence: Record<string, number>
  provenanceFields: Record<string, Ref>
  initialTarget: ProvenanceTarget | null
  conflictingLabels: string[]
  missingRequiredFields: string[]
  saveReview: (formData: FormData) => Promise<void>
  note: string
  auditEvents: Array<{ id: string; label: string; createdAt: string; actorName: string | null }>
  prevHref: string | null
  nextHref: string | null
  /** Where this document sits in the filtered queue it was opened from (1-indexed), for the
   * "3 of 12" counter — null when there's no `?stage=` context (opened from search, an analytics
   * link, etc.) to count a position within. */
  position: { index: number; total: number } | null
  /** The stage the reader arrived from, if any — decides which of Archive/Move to Ready make
   * sense to offer (the same rules components/pipeline/bulk-action-bar.tsx uses). */
  stage: PipelineStage | null
  /** Where Archive/Move to Ready send the reader afterward: the next document in the same queue,
   * or back to the list once there is no next one. */
  afterActionHref: string
  header: { filename: string; documentId: string; fileId: string; status: string; flagged: boolean; reviewLink: { href: string; label: string } | null }
  canPush: boolean
  pushCard: ReactNode
  canCreateRule: boolean
  defaultSupplier: string
  matchKind: "bank" | "supplier_statement" | null
  bankMatches: ReactNode
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("details")
  const [target, setTarget] = useState<ProvenanceTarget | null>(initialTarget)
  const [note, setNote] = useState(initialNote)
  const [savingNote, setSavingNote] = useState(false)
  const [flagged, setFlagged] = useState(header.flagged)
  const [busyAction, setBusyAction] = useState<"flag" | "archive" | "ready" | null>(null)

  // Groups the array field (line items) together with whatever numeric fields the template
  // declares immediately before it — Subtotal/Tax total/Total for an invoice, opening/closing
  // balance for a bank statement — so they render as one "Line items" section instead of being
  // scattered among the header-level fields above. Positional, not name-matched: it works for any
  // template whose author already put its summary numbers next to the array they total, with no
  // per-template-code special-casing here.
  const arrayIndex = fields.findIndex((field) => field.type === "array")
  let summaryStart = arrayIndex
  while (summaryStart > 0 && fields[summaryStart - 1].type === "number") summaryStart--
  const summaryFields = arrayIndex > -1 ? fields.slice(summaryStart, arrayIndex) : []
  const summaryKeys = new Set(summaryFields.map((field) => field.key))
  const formFields = fields.filter((field) => !summaryKeys.has(field.key))

  const saveNote = async () => {
    setSavingNote(true)
    try {
      const result = await updateDocumentNoteAction(workspaceId, header.documentId, note)
      if (!result.success) { toast.error(result.error || "Could not save the note"); return }
      toast.success("Note saved")
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setSavingNote(false)
    }
  }

  const toggleFlag = async () => {
    setBusyAction("flag")
    const next = !flagged
    try {
      const result = await flagDocumentsAction(workspaceId, [header.documentId], next)
      if (!result.success) { toast.error(result.error || "Could not update the flag"); return }
      setFlagged(next)
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setBusyAction(null)
    }
  }

  const archive = async () => {
    setBusyAction("archive")
    try {
      const result = await archiveDocumentsAction(workspaceId, [header.documentId], true)
      if (!result.success) { toast.error(result.error || "Could not archive this document"); return }
      toast.success("Archived")
      router.push(afterActionHref)
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setBusyAction(null)
    }
  }

  const moveToReady = async () => {
    setBusyAction("ready")
    try {
      const result = await moveDocumentsToStageAction(workspaceId, [header.documentId], "ready")
      if (!result.success) { toast.error(result.error || "Could not move this document"); return }
      toast.success("Moved to Ready")
      router.push(afterActionHref)
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setBusyAction(null)
    }
  }

  const tabButton = (value: Tab, label: string) => <button type="button" key={value}
    className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === value ? "border-emerald-700 bg-white text-emerald-800" : "border-transparent text-slate-500 hover:bg-white/60 hover:text-slate-800"}`}
    onClick={() => setTab(value)}>{label}</button>

  const toolbarBtn = "inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"

  // h-screen (not min-h-0 flex-1) deliberately: the ancestor chain up to the workspace shell only
  // guarantees min-height, not a clamped height, so a flex-1 child here would grow to fit its
  // tallest descendant instead of being clipped to the viewport — and then neither pane's own
  // overflow-y-auto ever kicks in, the whole document scrolls as one long page, and anything
  // meant to float relative to a pane (the PDF viewer's zoom toolbar) ends up pinned to the
  // bottom of that oversized page instead of the visible pane. Sizing directly off the viewport
  // here is what makes both panes actually own their own internal scroll.
  return <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
    <div className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-2.5">
      <Link href={stage ? `/workspaces/${workspaceId}/pipeline?stage=${stage}` : `/workspaces/${workspaceId}/pipeline`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
        <ArrowLeft className="h-4 w-4" />Back
      </Link>
      <button type="button" title={flagged ? "Remove flag" : "Flag for attention"} disabled={busyAction === "flag"} onClick={() => void toggleFlag()}
        className={`rounded-md p-1.5 ${flagged ? "text-indigo-500 hover:bg-indigo-50" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}>
        <Flag className={`h-4 w-4 ${flagged ? "fill-indigo-400" : ""}`} />
      </button>

      {stage !== "ready" && stage !== "archive" && stage !== null && <button type="button" disabled={busyAction === "ready"} onClick={() => void moveToReady()} className={toolbarBtn}>
        {busyAction === "ready" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Move to Ready
      </button>}
      {stage !== "archive" && <button type="button" disabled={busyAction === "archive"} onClick={() => void archive()} className={toolbarBtn}>
        {busyAction === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Archive
      </button>}

      <div className="ml-auto flex items-center gap-2">
        {position && <span className="text-sm tabular-nums text-slate-500">{position.index} / {position.total}</span>}
        <Link href={prevHref ?? "#"} aria-disabled={!prevHref} className={`rounded p-1.5 ${prevHref ? "text-slate-600 hover:bg-slate-100" : "pointer-events-none text-slate-300"}`}><ChevronLeft className="h-4 w-4" /></Link>
        <Link href={nextHref ?? "#"} aria-disabled={!nextHref} className={`rounded p-1.5 ${nextHref ? "text-slate-600 hover:bg-slate-100" : "pointer-events-none text-slate-300"}`}><ChevronRight className="h-4 w-4" /></Link>
      </div>
    </div>

    <div className="flex items-center gap-3 border-b bg-white px-6 py-3 shadow-sm">
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900" title={header.filename}>{header.filename}</h1>
      <Badge>{header.status.replaceAll("_", " ")}</Badge>
      {header.reviewLink && <Link className="text-sm underline" href={header.reviewLink.href}>{header.reviewLink.label}</Link>}
      <DeleteDocumentButton workspaceId={workspaceId} fileId={header.fileId} documentId={header.documentId} filename={header.filename} />
    </div>

    {(missingRequiredFields.length > 0 || conflictingLabels.length > 0) && <div className="border-b bg-indigo-50 px-6 py-2 text-sm text-indigo-800">
      {missingRequiredFields.length > 0 && <p>Missing required fields: {missingRequiredFields.join(", ")}</p>}
      {conflictingLabels.length > 0 && <p>Pages of this document disagreed on: {conflictingLabels.join(", ")} — please confirm against the source.</p>}
    </div>}

    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
      <div className="flex min-h-0 basis-[55%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <SourceViewer source={source} target={target} />
      </div>

      <div className="flex min-h-0 basis-[45%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex gap-1 border-b bg-slate-50 px-3 pt-2">{tabButton("details", "Details")}{tabButton("note", "Note")}{tabButton("activity", "Activity")}</div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "details" && <div className="space-y-5 p-5">
            <form action={saveReview} className="space-y-5">
              {formFields.map((field) => field.type === "array"
                ? <LineItemsSection key={field.key} field={field} value={data[field.key]} fieldKey={field.key} summaryFields={summaryFields} fieldValues={data} provenanceFields={provenanceFields} onFocusSource={setTarget} />
                : <FieldRow key={field.key} field={field} value={data[field.key]} confidence={fieldConfidence[field.key] ?? null} ref={provenanceFields[field.key] ?? null} onFocusSource={setTarget} />)}
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">Save review</button>
            </form>

            {canPush && pushCard}

            {canCreateRule && <Card>
              <CardHeader><CardTitle>Create a rule from this document</CardTitle><CardDescription>Matches this supplier automatically on future documents.</CardDescription></CardHeader>
              <CardContent><AutomationRuleForm workspaceId={workspaceId} defaultSupplier={defaultSupplier} /></CardContent>
            </Card>}

            {matchKind && bankMatches}

            {!header.reviewLink && <CreateReviewTaskButton workspaceId={workspaceId} documentId={header.documentId} />}
          </div>}

          {tab === "note" && <div className="space-y-2 p-5">
            <textarea className="min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="A note only your team sees — not sent anywhere, not part of the extracted data."
              value={note} onChange={(event) => setNote(event.target.value)} />
            <button type="button" disabled={savingNote} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => void saveNote()}>
              {savingNote && <Loader2 className="h-4 w-4 animate-spin" />}Save note
            </button>
          </div>}

          {tab === "activity" && <div className="p-5">
            {auditEvents.length === 0 ? <p className="text-sm text-slate-400">No activity recorded yet.</p> : <ul className="space-y-2 text-sm">
              {auditEvents.map((event) => <li key={event.id} className="flex items-center justify-between gap-2 border-b pb-2">
                <span className="text-slate-700">{event.label}</span>
                <span className="text-xs text-slate-400">{event.actorName ?? "System"} · {new Date(event.createdAt).toLocaleString()}</span>
              </li>)}
            </ul>}
          </div>}
        </div>
      </div>
    </div>
  </div>
}
