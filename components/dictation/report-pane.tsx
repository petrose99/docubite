"use client"

import { updateDraftNarrativeAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { createReportDraftAction, signReportAction } from "@/app/(app)/workspaces/[workspaceId]/report-actions"
import type { DictationDraft } from "@/components/dictation/dictation-workspace"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CheckCircle2, FileText, Loader2, PencilLine, ShieldCheck, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/** The same summary lib/report-completeness's describeCompleteness produces, restated here.
 *
 * NOT imported from there: that module reaches lib/report-render/narrative, which imports the LLM
 * provider and the server config, and pulling it into a client component would bundle both into the
 * browser. Duplicating six lines of prose is the cheaper mistake — and the checklist below renders
 * the same report structurally, so a drift in wording cannot hide a gap. */
function describeCompleteness(report: DictationDraft["completeness"]): string {
  if (report.complete) return "Every templated field was dictated and nothing was marked unclear."
  const parts: string[] = []
  if (report.missingRequired?.length) parts.push(`${report.missingRequired.length} required field(s) not dictated: ${report.missingRequired.join(", ")}`)
  if (report.unclearSections?.length) parts.push(`unclear audio in: ${report.unclearSections.join(", ")}`)
  if (report.emptySections?.length) parts.push(`sections not dictated: ${report.emptySections.join(", ")}`)
  if (report.missingOptional?.length) parts.push(`${report.missingOptional.length} optional field(s) not dictated`)
  if (!parts.length) return ""
  // Sentence-cased: whichever gap comes first leads the dialog, and "sections not dictated: …" as
  // the opening words of a sign-off prompt reads like a fragment someone forgot to finish.
  const sentence = parts.join("; ")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** The report: draft it, read it, sign it.
 *
 * The rendered text is shown verbatim, in a monospace block, including the DRAFT banner and every
 * `[missing: …]` marker. Those are part of the text rather than UI decoration — they survive
 * copy-paste, export and print, which is how a draft actually escapes the screen — so this pane
 * must never style them away or "tidy" them out of the preview. */
export function ReportPane({ workspaceId, documentId, draft, draftHistory, sections, reportTemplateName, transcriptEdited, disabled }: {
  workspaceId: string
  documentId: string
  draft: DictationDraft | null
  draftHistory: { id: string; version: number; status: string; signedAt: string | null }[]
  sections: { key: string; title: string }[]
  reportTemplateName: string | null
  transcriptEdited: boolean
  disabled: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"draft" | "save" | "sign" | null>(null)
  const [editing, setEditing] = useState(false)
  const [narrative, setNarrative] = useState<Record<string, string>>(draft?.narrative ?? {})
  const [confirmSign, setConfirmSign] = useState(false)

  // A NEW draft version replaces what is being edited; saving sections on the SAME draft does not,
  // because the text on screen is already what was just saved. Keyed on the draft id for exactly
  // that reason, and adjusted during render rather than in an effect.
  const [lastDraftId, setLastDraftId] = useState(draft?.id ?? null)
  if (lastDraftId !== (draft?.id ?? null)) {
    setLastDraftId(draft?.id ?? null)
    setNarrative(draft?.narrative ?? {})
    setEditing(false)
  }

  const signed = draft?.status === "signed"

  const run = async <T,>(kind: "draft" | "save" | "sign", work: () => Promise<{ success: boolean; error?: string; data?: T }>, done: string) => {
    setBusy(kind)
    try {
      const result = await work()
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong")
        return
      }
      toast.success(done)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (!reportTemplateName) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Report</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          This workspace has no report template, so there is no format to draft into. Add one in Settings → Report templates.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Report</h2>
        {draft && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${signed ? "bg-emerald-50 text-emerald-800" : "bg-indigo-50 text-indigo-800"}`}>
            v{draft.version} · {signed ? "signed" : "draft"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!signed && (
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={() => void run("draft", () => createReportDraftAction(workspaceId, documentId), draft ? "New draft created" : "Draft created")}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
              {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {draft ? "Re-draft" : "Draft report"}
            </button>
          )}
          {draft && !signed && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmSign(true)}
              className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50">
              <ShieldCheck className="h-3.5 w-3.5" />Sign
            </button>
          )}
        </span>
      </header>

      {!draft && (
        <p className="px-4 py-8 text-sm text-slate-500">
          {disabled
            ? "A report can be drafted once the recording has been transcribed."
            : `Draft a ${reportTemplateName.toLowerCase()} from the fields and transcript. Nothing is finalised until you sign it.`}
        </p>
      )}

      {draft && (
        <div className="min-w-0 space-y-3 px-4 py-3">
          {signed && (
            <p className="flex items-start gap-2 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Signed by {draft.signedBy ?? "a member"} on {draft.signedAt ? new Date(draft.signedAt).toLocaleString() : "—"}. This version cannot be changed; a correction is a new draft.
            </p>
          )}

          {/* Kept visible after signing, with the tense corrected. The gaps are a property of the
              report someone put their name to, not a to-do list that stops mattering once they
              have — hiding them post-signature would make a signed report with holes in it look
              like a signed report without any. */}
          <Completeness report={draft.completeness} signed={signed} />

          <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
            {draft.renderedText}
          </pre>

          {!signed && sections.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setEditing((open) => !open)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800">
                <PencilLine className="h-3.5 w-3.5" />{editing ? "Hide section editing" : "Edit narrative sections"}
              </button>

              {editing && (
                <div className="mt-2 space-y-2.5">
                  {sections.map((section) => (
                    <div key={section.key}>
                      <label htmlFor={`section-${section.key}`} className="text-xs font-medium text-slate-700">{section.title}</label>
                      <textarea
                        id={`section-${section.key}`}
                        rows={3}
                        value={narrative[section.key] ?? ""}
                        onChange={(event) => setNarrative((state) => ({ ...state, [section.key]: event.target.value }))}
                        className="mt-1 w-full resize-y rounded-md border border-slate-200 p-2 text-xs leading-relaxed text-slate-800 focus:border-emerald-400 focus:outline-none" />
                    </div>
                  ))}
                  {/* The synoptic block is absent from this list on purpose: it is rendered
                      deterministically from the extracted values, and typing over it would sever the
                      only link between what the report says and what was dictated. Correct the field. */}
                  <p className="text-xs text-slate-400">
                    Only the prose is editable. The synoptic block comes from the fields — correct it there.
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run("save", () => updateDraftNarrativeAction(workspaceId, draft.id, narrative), "Sections saved")}
                    className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-900 disabled:opacity-50">
                    {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save sections
                  </button>
                </div>
              )}
            </div>
          )}

          {draftHistory.length > 1 && (
            <p className="text-xs text-slate-400">
              {draftHistory.length} versions. Earlier drafts are kept, so what a signer saw stays recoverable.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmSign}
        title="Sign this report?"
        confirmLabel="Sign"
        busy={busy === "sign"}
        description={[
          draft?.completeness ? describeCompleteness(draft.completeness) : "",
          transcriptEdited ? "The transcript was corrected by hand, so this report is not drawn from an unedited transcription." : "",
          "Signing is attributable to you and final — a later correction is a new draft, not a change to this one.",
        ].filter(Boolean).join(" ")}
        onCancel={() => setConfirmSign(false)}
        onConfirm={async () => {
          if (!draft) return
          await run("sign", () => signReportAction(workspaceId, draft.id), "Report signed")
          setConfirmSign(false)
        }} />
    </section>
  )
}

/** The pre-sign-off checklist. Leads with required gaps because that is the decision being made.
 *
 * It reports; it does not block. A pathologist may legitimately sign a report where an optional
 * section was never dictated, and that judgement is theirs — what the system guarantees is that
 * they cannot sign one without the gaps having been shown to them. */
function Completeness({ report, signed }: { report: DictationDraft["completeness"]; signed: boolean }) {
  if (!report) return null
  if (report.complete) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Every templated field was dictated and nothing was marked unclear.
      </p>
    )
  }
  return (
    <div className="rounded-md bg-indigo-50 px-2.5 py-2 text-xs text-indigo-900">
      <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5 shrink-0" />{signed ? "Signed with these gaps" : "Before signing"}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {report.missingRequired?.length > 0 && <li>Required, not dictated: {report.missingRequired.join(", ")}</li>}
        {report.unclearSections?.length > 0 && <li>Audio the transcription could not make out, in: {report.unclearSections.join(", ")}</li>}
        {report.emptySections?.length > 0 && <li>Sections not dictated: {report.emptySections.join(", ")}</li>}
        {report.missingOptional?.length > 0 && <li>{report.missingOptional.length} optional field(s) not dictated</li>}
      </ul>
    </div>
  )
}
