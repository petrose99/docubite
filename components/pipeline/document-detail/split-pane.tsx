"use client"

import { AutomationRuleForm } from "@/components/workspace/automation-rule-form"
import { CreateReviewTaskButton } from "@/components/documents/create-review-task-button"
import { DeleteDocumentButton } from "@/components/documents/delete-document-button"
import { FieldRow } from "@/components/pipeline/document-detail/field-row"
import { LineItemsSection } from "@/components/pipeline/document-detail/line-items-section"
import { archiveDocumentsAction, flagDocumentsAction, moveDocumentsToStageAction, updateDocumentNoteAction } from "@/app/(app)/workspaces/[workspaceId]/pipeline-actions"
import { setDocumentTypeAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SourceViewer, type ProvenanceTarget, type SourceDocument } from "@/components/viewer/source-preview"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { PipelineStage } from "@/lib/documents/stages"
import type { Ref } from "@/lib/provenance"
import { Archive, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Eye, EyeOff, Flag, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

type Tab = "details" | "note" | "activity"
type PanelLayout = "split" | "source-only" | "details-only"

export function SplitPane({
  workspaceId, source, fields, data, fieldConfidence, provenanceFields, initialTarget, conflictingLabels, missingRequiredFields,
  saveReview, documentType: initialDocumentType, suggestedDocumentType, note: initialNote, auditEvents, prevHref, nextHref, position, stage, afterActionHref,
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
  documentType: "expense" | "sale" | null
  suggestedDocumentType: string | null
  note: string
  auditEvents: Array<{ id: string; label: string; createdAt: string; actorName: string | null }>
  prevHref: string | null
  nextHref: string | null
  position: { index: number; total: number } | null
  stage: PipelineStage | null
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
  const [docType, setDocType] = useState<"expense" | "sale" | null>(initialDocumentType)
  const [savingDocType, setSavingDocType] = useState(false)
  const [busyAction, setBusyAction] = useState<"flag" | "archive" | "ready" | null>(null)
  const [layout, setLayout] = useState<PanelLayout>("split")

  const suggestedType: "expense" | "sale" | null = (() => {
    if (initialDocumentType) return null
    const dt = (suggestedDocumentType ?? "").toLowerCase()
    if (["invoice", "receipt", "bill", "purchase_order", "expense"].some((k) => dt.includes(k))) return "expense"
    if (["sales_invoice", "credit_note", "quotation", "sales"].some((k) => dt.includes(k))) return "sale"
    return null
  })()

  const selectDocType = async (type: "expense" | "sale") => {
    setSavingDocType(true)
    setDocType(type)
    try {
      const result = await setDocumentTypeAction(workspaceId, header.documentId, type)
      if (!result.success) { toast.error(result.error || "Could not save document type"); setDocType(docType); return }
    } catch {
      toast.error("Could not reach the server")
      setDocType(docType)
    } finally {
      setSavingDocType(false)
    }
  }

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

  const cycleLayout = () => {
    setLayout((prev) => {
      if (prev === "split") return "details-only"
      if (prev === "details-only") return "source-only"
      return "split"
    })
  }

  const tabButton = (value: Tab, label: string) => <button type="button" key={value}
    className={`rounded-t-md border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === value ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
    onClick={() => setTab(value)}>{label}</button>

  const toolbarBtn = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-40 transition-colors"

  const statusColor = header.status === "reviewed" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : header.status === "needs_review" || header.status === "ready_for_review" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-slate-100 text-slate-700 border-slate-200"

  const showSource = layout === "split" || layout === "source-only"
  const showDetails = layout === "split" || layout === "details-only"

  return <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
    {/* Top bar */}
    <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
      <Link href={stage ? `/workspaces/${workspaceId}/pipeline?stage=${stage}` : `/workspaces/${workspaceId}/pipeline`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" />Back
      </Link>

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800" title={header.filename}>{header.filename}</h1>

      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>
        {header.status.replaceAll("_", " ")}
      </span>

      {docType && <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${docType === "expense" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
        {docType === "expense" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {docType === "expense" ? "Expense" : "Sale"}
      </span>}

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <button type="button" title={flagged ? "Remove flag" : "Flag for attention"} disabled={busyAction === "flag"} onClick={() => void toggleFlag()}
        className={`rounded-lg p-1.5 transition-colors ${flagged ? "bg-indigo-50 text-indigo-500" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}>
        <Flag className={`h-4 w-4 ${flagged ? "fill-indigo-400" : ""}`} />
      </button>

      {stage !== "ready" && stage !== "archive" && stage !== null && <button type="button" disabled={busyAction === "ready"} onClick={() => void moveToReady()} className={toolbarBtn}>
        {busyAction === "ready" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Ready
      </button>}
      {stage !== "archive" && <button type="button" disabled={busyAction === "archive"} onClick={() => void archive()} className={toolbarBtn}>
        {busyAction === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Archive
      </button>}

      {header.reviewLink && <Link className="text-xs text-emerald-600 underline" href={header.reviewLink.href}>{header.reviewLink.label}</Link>}

      <DeleteDocumentButton workspaceId={workspaceId} fileId={header.fileId} documentId={header.documentId} filename={header.filename} />

      <div className="mx-2 h-5 w-px bg-slate-200" />

      {/* Layout toggle */}
      <button type="button" onClick={cycleLayout} title={layout === "split" ? "Expand details" : layout === "details-only" ? "Show source only" : "Split view"} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
        {layout === "split" ? <Maximize2 className="h-4 w-4" /> : layout === "details-only" ? <PanelLeftOpen className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
      </button>

      {position && <span className="text-xs tabular-nums text-slate-400">{position.index}/{position.total}</span>}
      <Link href={prevHref ?? "#"} aria-disabled={!prevHref} className={`rounded-lg p-1 ${prevHref ? "text-slate-500 hover:bg-slate-100 hover:text-slate-700" : "pointer-events-none text-slate-300"}`}><ChevronLeft className="h-4 w-4" /></Link>
      <Link href={nextHref ?? "#"} aria-disabled={!nextHref} className={`rounded-lg p-1 ${nextHref ? "text-slate-500 hover:bg-slate-100 hover:text-slate-700" : "pointer-events-none text-slate-300"}`}><ChevronRight className="h-4 w-4" /></Link>
    </div>

    {/* Alert banner */}
    {(missingRequiredFields.length > 0 || conflictingLabels.length > 0) && <div className="border-b border-indigo-200 bg-indigo-50 px-6 py-2 text-sm text-indigo-700">
      {missingRequiredFields.length > 0 && <p>Missing required fields: <strong>{missingRequiredFields.join(", ")}</strong></p>}
      {conflictingLabels.length > 0 && <p>Pages disagreed on: <strong>{conflictingLabels.join(", ")}</strong> — please confirm against the source.</p>}
    </div>}

    {/* Main content area */}
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Source panel */}
      {showSource && <div className={`flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-all ${layout === "source-only" ? "flex-1" : "basis-[52%]"}`}>
        {layout !== "split" && <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Source document</span>
          <button type="button" onClick={() => setLayout("split")} className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Split view">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>}
        <SourceViewer source={source} target={target} />
      </div>}

      {/* Details panel */}
      {showDetails && <div className={`flex min-h-0 flex-col overflow-hidden bg-white transition-all ${layout === "details-only" ? "flex-1" : "basis-[48%]"}`}>
        <div className="flex items-center border-b border-slate-100">
          <div className="flex gap-0.5 px-3 pt-1">
            {tabButton("details", "Details")}
            {tabButton("note", "Note")}
            {tabButton("activity", "Activity")}
          </div>
          {layout !== "split" && <button type="button" onClick={() => setLayout("split")} className="ml-auto mr-3 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Split view">
            <PanelLeftOpen className="h-4 w-4" />
          </button>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "details" && <div className={`mx-auto space-y-4 p-4 ${layout === "details-only" ? "max-w-2xl" : ""}`}>
            {/* Document type confirmation — compact inline when confirmed, prominent when not */}
            {docType ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <span className="text-xs font-medium text-slate-500">Type</span>
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${docType === "expense" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {docType === "expense" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {docType === "expense" ? "Expense" : "Sale"}
                </span>
                <button type="button" disabled={savingDocType} onClick={() => void selectDocType(docType === "expense" ? "sale" : "expense")}
                  className="ml-auto text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600">Change</button>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50/80 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">What type of document is this?</p>
                  <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">Required</span>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" disabled={savingDocType} onClick={() => void selectDocType("expense")}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition-all hover:border-red-200 hover:bg-red-50/50 hover:text-red-700">
                    <ArrowUp className="h-3.5 w-3.5" />Expense
                    {suggestedType === "expense" && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700">Suggested</span>}
                  </button>
                  <button type="button" disabled={savingDocType} onClick={() => void selectDocType("sale")}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition-all hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700">
                    <ArrowDown className="h-3.5 w-3.5" />Sale
                    {suggestedType === "sale" && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700">Suggested</span>}
                  </button>
                </div>
                <p className="mt-2 text-xs text-amber-700/80">Expense (money out) or sale (money in)?</p>
              </div>
            )}

            {/* Review form */}
            <form action={saveReview} className="space-y-3">
              {formFields.map((field) => field.type === "array"
                ? <LineItemsSection key={field.key} field={field} value={data[field.key]} fieldKey={field.key} summaryFields={summaryFields} fieldValues={data} provenanceFields={provenanceFields} onFocusSource={setTarget} />
                : <FieldRow key={field.key} field={field} value={data[field.key]} confidence={fieldConfidence[field.key] ?? null} ref={provenanceFields[field.key] ?? null} onFocusSource={setTarget} />)}

              <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
                <button type="submit" disabled={!docType} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40" title={!docType ? "Choose Expense or Sale first" : undefined}>
                  <CheckCircle2 className="h-4 w-4" />Save review
                </button>
                {!docType && <span className="text-xs text-amber-600">Choose a document type first</span>}
              </div>
            </form>

            {canPush && <div className="pt-2">{pushCard}</div>}

            {canCreateRule && <Card className="border-slate-200 shadow-sm">
              <CardHeader><CardTitle>Create a rule from this document</CardTitle><CardDescription>Matches this supplier automatically on future documents.</CardDescription></CardHeader>
              <CardContent><AutomationRuleForm workspaceId={workspaceId} defaultSupplier={defaultSupplier} /></CardContent>
            </Card>}

            {matchKind && bankMatches}

            {!header.reviewLink && <CreateReviewTaskButton workspaceId={workspaceId} documentId={header.documentId} />}
          </div>}

          {tab === "note" && <div className={`mx-auto space-y-3 p-6 ${layout === "details-only" ? "max-w-2xl" : ""}`}>
            <textarea className="min-h-48 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm transition-colors focus:border-emerald-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100" placeholder="A note only your team sees — not sent anywhere, not part of the extracted data."
              value={note} onChange={(event) => setNote(event.target.value)} />
            <button type="button" disabled={savingNote} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40" onClick={() => void saveNote()}>
              {savingNote && <Loader2 className="h-4 w-4 animate-spin" />}Save note
            </button>
          </div>}

          {tab === "activity" && <div className={`mx-auto p-6 ${layout === "details-only" ? "max-w-2xl" : ""}`}>
            {auditEvents.length === 0 ? <p className="text-sm text-slate-400">No activity recorded yet.</p> : <div className="space-y-1">
              {auditEvents.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50">
                <span className="text-sm text-slate-700">{event.label}</span>
                <span className="shrink-0 text-xs text-slate-400">{event.actorName ?? "System"} · {new Date(event.createdAt).toLocaleString()}</span>
              </div>)}
            </div>}
          </div>}
        </div>
      </div>}
    </div>
  </div>
}
