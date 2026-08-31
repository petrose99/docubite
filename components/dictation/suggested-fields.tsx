"use client"

import { acceptFieldSuggestionsAction, dismissFieldSuggestionAction, dismissFieldSuggestionsAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { Check, CheckCheck, Loader2, Sparkles, X, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"

export type PendingFieldSuggestion = {
  id: string
  key: string
  label: string
  type: string
  instruction: string
  value: string
  quote: string
  confidence: number | null
}

const FIELD_TYPES = ["string", "number", "date", "boolean"] as const
type FieldType = (typeof FIELD_TYPES)[number]

type Draft = { label: string; type: FieldType; value: string }

const draftFor = (suggestion: PendingFieldSuggestion): Draft => ({
  label: suggestion.label,
  type: FIELD_TYPES.includes(suggestion.type as FieldType) ? (suggestion.type as FieldType) : "string",
  value: suggestion.value,
})

/** Fields the model noticed had nowhere to go (a supplement-mode proposal against a fixed
 * template) or discovered from scratch (discover mode â€” no template fields at all, see
 * lib/field-suggestions.ts). Shown separately from Extracted fields â€” these are not yet part of
 * the template, so mixing them in would claim a schema decision nobody has made.
 *
 * Each suggestion is editable before accepting: discover mode can propose a dozen fields in one
 * pass, and requiring a template-editor round trip to fix a label or reclassify a type before it's
 * even real would make bulk review unusable. The review a proposal still needs is "is this real,
 * and is this the right shape" â€” nothing more; a deeper rename after acceptance is an ordinary
 * template edit. */
export function SuggestedFields({ workspaceId, documentId, suggestions }: { workspaceId: string; documentId: string; suggestions: PendingFieldSuggestion[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<{ id: string | "all"; action: "accept" | "dismiss" } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const ordered = useMemo(
    () => [...suggestions].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1)),
    [suggestions],
  )

  if (!ordered.length) return null

  const draftOf = (suggestion: PendingFieldSuggestion): Draft => drafts[suggestion.id] ?? draftFor(suggestion)
  const setDraft = (id: string, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [id]: { ...draftFor(ordered.find((s) => s.id === id)!), ...prev[id], ...patch } }))

  const itemFor = (suggestion: PendingFieldSuggestion) => {
    const draft = draftOf(suggestion)
    return { suggestionId: suggestion.id, label: draft.label, type: draft.type, value: draft.value }
  }

  const decide = async (suggestion: PendingFieldSuggestion, action: "accept" | "dismiss") => {
    setPending({ id: suggestion.id, action })
    try {
      const result = action === "accept"
        ? await acceptFieldSuggestionsAction(workspaceId, documentId, [itemFor(suggestion)])
        : await dismissFieldSuggestionAction(workspaceId, documentId, suggestion.id)
      if (!result.success) {
        toast.error(result.error ?? "Could not update that suggestion")
        return
      }
      if (action === "accept") toast.success(`Added "${draftOf(suggestion).label}"`)
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  const decideAll = async (action: "accept" | "dismiss") => {
    setPending({ id: "all", action })
    try {
      const result = action === "accept"
        ? await acceptFieldSuggestionsAction(workspaceId, documentId, ordered.map(itemFor))
        : await dismissFieldSuggestionsAction(workspaceId, documentId)
      if (!result.success) {
        toast.error(result.error ?? "Could not update those suggestions")
        return
      }
      if (action === "accept") toast.success(`Added ${ordered.length} field${ordered.length === 1 ? "" : "s"}`)
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-emerald-100 px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
        <h2 className="text-sm font-semibold text-slate-900">Suggested fields</h2>
        <span className="text-xs text-slate-500">Said in this recording, not in the template yet</span>
        {ordered.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void decideAll("dismiss")}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50">
              {pending?.id === "all" && pending.action === "dismiss" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Dismiss all
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void decideAll("accept")}
              className="flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50">
              {pending?.id === "all" && pending.action === "accept" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Accept all ({ordered.length})
            </button>
          </div>
        )}
      </header>

      <div className="divide-y divide-emerald-100">
        {ordered.map((suggestion) => {
          const busy = pending?.id === suggestion.id
          const draft = draftOf(suggestion)
          return (
            <div key={suggestion.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      value={draft.label}
                      onChange={(event) => setDraft(suggestion.id, { label: event.target.value })}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-200 focus:border-emerald-300 focus:bg-white focus:outline-none"
                      placeholder="Field name"
                    />
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft(suggestion.id, { type: event.target.value as FieldType })}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-500 focus:border-emerald-300 focus:outline-none">
                      {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    {typeof suggestion.confidence === "number" && (
                      <span className="text-[11px] text-slate-400">{Math.round(suggestion.confidence * 100)}%</span>
                    )}
                  </div>
                  <input
                    value={draft.value}
                    onChange={(event) => setDraft(suggestion.id, { value: event.target.value })}
                    className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 hover:border-slate-200 focus:border-emerald-300 focus:bg-white focus:outline-none"
                  />
                  {suggestion.quote && <p className="truncate px-1 text-xs italic text-slate-500" title={suggestion.quote}>&ldquo;{suggestion.quote}&rdquo;</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void decide(suggestion, "dismiss")}
                    title="Dismiss"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50">
                    {busy && pending?.action === "dismiss" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void decide(suggestion, "accept")}
                    title="Add to template"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-300 bg-white text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50">
                    {busy && pending?.action === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
