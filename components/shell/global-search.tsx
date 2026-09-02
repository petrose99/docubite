"use client"

import { globalSearchAction, type GlobalSearchResult } from "@/app/(app)/workspaces/[workspaceId]/search-actions"
import type { SearchResultItem } from "@/lib/global-search"
import { FileText, Loader2, Search, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

export function GlobalSearch({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const search = useCallback((q: string) => {
    setQuery(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q.trim()) { setResult(null); setLoading(false); return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const r = await globalSearchAction(workspaceId, q)
        setResult(r)
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [workspaceId])

  const close = useCallback(() => {
    setOpen(false)
    setQuery("")
    setResult(null)
  }, [])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:bg-white"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline-block">
          ⌘K
        </kbd>
      </button>
    )
  }

  const docs = result?.items.filter((i) => i.type === "document") ?? []
  const snippets = result?.items.filter((i) => i.type === "snippet").slice(0, 5) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40" onClick={close}>
      <div
        className="flex max-h-[60vh] w-full max-w-xl flex-col rounded-2xl border border-[#e6ebf1] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documents... (vendor:acme, amount>500)"
            value={query}
            onChange={(e) => search(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <button onClick={close} className="rounded p-1 text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!result && !loading && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Type to search across all documents
            </div>
          )}

          {result && docs.length === 0 && snippets.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No results found
            </div>
          )}

          {docs.length > 0 && (
            <div>
              <div className="px-4 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Documents ({docs.length})
              </div>
              <div className="divide-y divide-slate-100">
                {docs.slice(0, 10).map((item) => (
                  <SearchDocItem key={item.id} item={item} workspaceId={workspaceId} onClick={close} />
                ))}
              </div>
            </div>
          )}

          {snippets.length > 0 && (
            <div>
              <div className="px-4 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Passages
              </div>
              <div className="divide-y divide-slate-100">
                {snippets.map((item) => (
                  <SearchSnippetItem key={item.id} item={item} workspaceId={workspaceId} onClick={close} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              {result ? `${result.total} result${result.total === 1 ? "" : "s"}` : ""}
            </span>
            {query.trim() && (
              <>
                <button
                  onClick={() => { close(); router.push(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`) }}
                  className="font-medium text-slate-500 hover:text-slate-700"
                >See all</button>
                <button
                  onClick={() => { close(); router.push(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}&ask=1`) }}
                  className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:text-emerald-700"
                ><Sparkles className="h-3 w-3" />Ask AI</button>
              </>
            )}
          </div>
          <span>
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px]">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}

function SearchDocItem({ item, workspaceId, onClick }: { item: SearchResultItem; workspaceId: string; onClick: () => void }) {
  return (
    <Link
      href={`/workspaces/${workspaceId}/pipeline?doc=${item.documentId}`}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
    >
      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">{item.filename}</div>
        <div className="flex gap-2 text-xs text-slate-400">
          {item.supplier && <span>{item.supplier}</span>}
          {item.total && <span>{item.total}</span>}
          {item.date && <span>{item.date}</span>}
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-slate-300">{(item.score * 100).toFixed(0)}</span>
    </Link>
  )
}

function SearchSnippetItem({ item, workspaceId, onClick }: { item: SearchResultItem; workspaceId: string; onClick: () => void }) {
  return (
    <Link
      href={`/workspaces/${workspaceId}/pipeline?doc=${item.documentId}${item.page != null ? `&page=${item.page}` : ""}`}
      onClick={onClick}
      className="block px-4 py-2.5 transition-colors hover:bg-slate-50"
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium text-slate-600">{item.filename}</span>
        {item.page != null && <span className="shrink-0 text-[10px] text-slate-300">p.{item.page}</span>}
      </div>
      {item.snippet && (
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.snippet}</p>
      )}
    </Link>
  )
}
