"use client"

import { Filter, Flag, Grid3x3, List, Search, Sparkles } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

const SCOPE_OPTIONS = [
  { value: "smart", label: "All" },
  { value: "content", label: "Content" },
  { value: "filename", label: "Filename" },
  { value: "supplier", label: "Supplier" },
  { value: "category", label: "Category" },
] as const

export function LibraryToolbar({ query, scope, view, flagged, pickMode, embeddingsEnabled }: {
  query: string
  scope: string
  view: string
  flagged: boolean
  pickMode: boolean
  embeddingsEnabled: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(query)

  useEffect(() => {
    if (value === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set("q", value); else params.delete("q")
      params.delete("page")
      router.push(`?${params.toString()}`)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const updateParam = (key: string, val: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (val) params.set(key, val); else params.delete(key)
    params.delete("page")
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={embeddingsEnabled ? "Search… try vendor:acme amount>500" : "Search documents..."}
          className="w-full rounded-md border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-emerald-400 focus:bg-white"
        />
      </div>

      <div className="relative inline-flex items-center">
        <Filter className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
        <select
          value={scope}
          onChange={(e) => updateParam("scope", e.target.value === "smart" ? null : e.target.value)}
          className="h-9 cursor-pointer appearance-none rounded-md border border-slate-200 bg-white py-0 pl-8 pr-7 text-xs font-medium text-slate-600 outline-none transition-colors hover:border-slate-300 focus:border-emerald-400"
          aria-label="Filter by"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === "smart" ? "Filter by: All" : `Filter by: ${opt.label}`}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => {
          const params = new URLSearchParams(searchParams.toString())
          params.set("mode", "ai")
          router.push(`?${params.toString()}`)
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
        title="Ask AI about your documents"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Ask AI
      </button>

      {!pickMode && (
        <>
          <div className="flex items-center rounded-md border border-slate-200">
            <button
              onClick={() => updateParam("view", "grid")}
              className={`rounded-l-md p-2 transition-colors ${view === "grid" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              title="Grid view"
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => updateParam("view", "list")}
              className={`rounded-r-md border-l border-slate-200 p-2 transition-colors ${view === "list" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Flag className={`h-3.5 w-3.5 ${flagged ? "text-amber-500" : ""}`} />
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-emerald-600"
              checked={flagged}
              onChange={() => updateParam("flagged", flagged ? null : "1")}
            />
          </label>
        </>
      )}
    </div>
  )
}
