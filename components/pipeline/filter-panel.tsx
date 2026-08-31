"use client"

import { Sparkles, Search } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

/** Search box + a couple of presence/absence toggles, URL-driven the same way the Files browser's
 * search box is. Column/other-filter persistence (UserListPreference) is wired at the shell level;
 * this component only owns the query string, which is what makes a filtered view shareable/
 * refreshable.
 *
 * When document search is configured, this is the same hybrid (vector + lexical, RRF-fused)
 * search the Files browser's content search runs — not just a filename match — so the placeholder
 * and the sparkle hint say so, and the results below carry a "Matched inside documents" section
 * for hits found by content rather than by name. */
export function FilterPanel({ query, flaggedOnly, documentSearchEnabled }: { query: string; flaggedOnly: boolean; documentSearchEnabled: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(query)

  useEffect(() => {
    if (value === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set("q", value); else params.delete("q")
      router.push(`?${params.toString()}`)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const toggleFlagged = () => {
    const params = new URLSearchParams(searchParams.toString())
    if (flaggedOnly) params.delete("flagged"); else params.set("flagged", "1")
    router.push(`?${params.toString()}`)
  }

  return <div className="flex flex-wrap items-center gap-3 border-b bg-stone-50/60 px-6 py-3">
    <div className="relative w-80 max-w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input className="w-full rounded-md border border-stone-300 bg-white py-1.5 pl-8 pr-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
        placeholder={documentSearchEnabled ? "Search documents and their content" : "Search documents"}
        value={value} onChange={(event) => setValue(event.target.value)} />
    </div>
    {documentSearchEnabled && value && (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
        <Sparkles className="h-3.5 w-3.5" />Also searching what&apos;s inside each document
      </span>
    )}
    <label className="ml-auto inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
      <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={flaggedOnly} onChange={toggleFlagged} />Flagged only
    </label>
  </div>
}
