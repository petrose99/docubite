"use client"

import { acceptFieldSuggestionAction, dismissFieldSuggestionAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { Check, Loader2, Sparkles, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
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

/** Fields the extraction model noticed had nowhere to go, waiting on a person to say whether they
 * are real. Shown separately from Extracted fields — these are not yet part of the template, so
 * mixing them into that list would claim a schema decision nobody has made.
 *
 * Accept and Dismiss are the only actions here on purpose. Editing the proposed label or value
 * before approving would be a third, unbuilt path; the review a proposal actually needs is "is
 * this a real, distinct field" — if the label needs fixing once it is real, that is a normal
 * template edit through the template editor, same as any other field. */
export function SuggestedFields({ workspaceId, documentId, suggestions }: { workspaceId: string; documentId: string; suggestions: PendingFieldSuggestion[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<{ id: string; action: "accept" | "dismiss" } | null>(null)

  if (!suggestions.length) return null

  const decide = async (suggestion: PendingFieldSuggestion, action: "accept" | "dismiss") => {
    setPending({ id: suggestion.id, action })
    try {
      const result = action === "accept"
        ? await acceptFieldSuggestionAction(workspaceId, documentId, suggestion.id)
        : await dismissFieldSuggestionAction(workspaceId, documentId, suggestion.id)
      if (!result.success) {
        toast.error(result.error ?? "Could not update that suggestion")
        return
      }
      if (action === "accept") toast.success(`Added "${suggestion.label}" to the template`)
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm">
      <header className="flex items-center gap-2 border-b border-emerald-100 px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
        <h2 className="text-sm font-semibold text-stone-900">Suggested fields</h2>
        <span className="text-xs text-stone-500">Said in this recording, not in the template yet</span>
      </header>

      <div className="divide-y divide-emerald-100">
        {suggestions.map((suggestion) => {
          const busy = pending?.id === suggestion.id
          return (
            <div key={suggestion.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-stone-700">{suggestion.label}</p>
                  <p className="mt-0.5 text-sm text-stone-900">{suggestion.value}</p>
                  {suggestion.quote && <p className="mt-1 truncate text-xs italic text-stone-500" title={suggestion.quote}>&ldquo;{suggestion.quote}&rdquo;</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decide(suggestion, "dismiss")}
                    title="Dismiss"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-stone-200 text-stone-500 transition-colors hover:bg-stone-100 disabled:opacity-50">
                    {busy && pending?.action === "dismiss" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
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
