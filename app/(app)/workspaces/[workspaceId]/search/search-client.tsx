"use client"

import { globalSearchAction, type GlobalSearchResult } from "@/app/(app)/workspaces/[workspaceId]/search-actions"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import type { SearchResultItem } from "@/lib/global-search"
import { FileText, Loader2, Search, Sparkles } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition } from "react"

export function SearchPageClient({ workspaceId, initialQuery, askMode = false }: {
  workspaceId: string
  initialQuery: string
  askMode?: boolean
}) {
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [searching, startSearch] = useTransition()
  const [showAssistant, setShowAssistant] = useState(askMode)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nullRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) { setResult(null); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      startSearch(async () => {
        const r = await globalSearchAction(workspaceId, query)
        setResult(r)
      })
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [workspaceId, query])

  const base = `/workspaces/${workspaceId}`

  return (
    <div className="flex h-full">
      <div className={`mx-auto max-w-3xl flex-1 px-6 py-8 ${showAssistant ? "mr-0" : ""}`}>
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents..."
            className="flex-1 bg-transparent text-base outline-none"
            autoFocus
          />
          {searching && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
          {!showAssistant && (
            <button
              onClick={() => setShowAssistant(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask AI
            </button>
          )}
        </div>

        {result && result.items.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">No results for &ldquo;{query}&rdquo;</p>
        )}

        {result && result.items.length > 0 && (
          <div className="space-y-1">
            {result.items.map((item) => (
              <ResultRow key={item.id} item={item} base={base} />
            ))}
          </div>
        )}
      </div>

      {showAssistant && (
        <AssistantPanel
          workspaceId={workspaceId}
          apiRef={nullRef}
          onClose={() => setShowAssistant(false)}
          documentSearchEnabled
          surface="dictation"
          title="Ask about documents"
          initialMessage={askMode ? query : undefined}
          className="flex w-80 shrink-0 flex-col border-l bg-slate-50"
        />
      )}
    </div>
  )
}

function ResultRow({ item, base }: { item: SearchResultItem; base: string }) {
  const href = item.type === "snippet"
    ? `${base}/pipeline?doc=${item.documentId}${item.page != null ? `&page=${item.page}` : ""}`
    : `${base}/pipeline?doc=${item.documentId}`

  return (
    <Link href={href} className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-slate-50">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{item.filename}</span>
          {item.page != null && (
            <span className="shrink-0 text-[10px] text-slate-400">p.{item.page}</span>
          )}
          <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
            {item.type === "document" ? "doc" : "passage"}
          </span>
        </div>
        <div className="flex gap-2 text-xs text-slate-400">
          {item.supplier && <span>{item.supplier}</span>}
          {item.total && <span>{item.total}</span>}
          {item.date && <span>{item.date}</span>}
        </div>
        {item.snippet && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.snippet}</p>
        )}
      </div>
    </Link>
  )
}
