"use client"

import type { LibraryFacets } from "@/models/library-facets"
import { X } from "lucide-react"
import Link from "next/link"

type FacetBarProps = {
  facets: LibraryFacets
  activeType: string | null
  activeCategory: string | null
  activeSupplier: string | null
  activeFrom: string | null
  activeTo: string | null
  baseParams: Record<string, string>
  basePath: string
}

function buildHref(basePath: string, baseParams: Record<string, string>, overrides: Record<string, string | null>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(baseParams)) {
    if (v && k !== "page") params.set(k, v)
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v) params.set(k, v); else params.delete(k)
  }
  params.delete("page")
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export function LibraryFacetBar({ facets, activeType, activeCategory, activeSupplier, activeFrom, activeTo, baseParams, basePath }: FacetBarProps) {
  const hasActive = activeType || activeCategory || activeSupplier || activeFrom || activeTo
  const hasAnyFacet = facets.templates.length > 0 || facets.categories.length > 0 || facets.suppliers.length > 0

  if (!hasAnyFacet && !hasActive) return null

  return (
    <div className="space-y-3">
      {facets.templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Type</span>
          {facets.templates.map((t) => {
            const isActive = activeType === t.id
            return (
              <Link
                key={t.id}
                href={buildHref(basePath, baseParams, { type: isActive ? null : t.id })}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t.name}
                <span className={`tabular-nums ${isActive ? "text-emerald-600" : "text-slate-400"}`}>{t.count}</span>
              </Link>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {facets.categories.length > 0 && (
          <div className="relative inline-flex">
            <select
              value={activeCategory ?? ""}
              onChange={(e) => {
                const val = e.target.value
                const params = new URLSearchParams()
                for (const [k, v] of Object.entries(baseParams)) { if (v && k !== "page") params.set(k, v) }
                if (val) params.set("category", val); else params.delete("category")
                params.delete("page")
                const qs = params.toString()
                window.location.href = qs ? `${basePath}?${qs}` : basePath
              }}
              className="h-8 appearance-none rounded-md border border-slate-200 bg-white py-0 pl-2.5 pr-7 text-xs text-slate-600 outline-none focus:border-emerald-400"
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {facets.categories.map((c) => (
                <option key={c.value} value={c.value}>{c.value} ({c.count})</option>
              ))}
            </select>
          </div>
        )}

        {facets.suppliers.length > 0 && (
          <div className="relative inline-flex">
            <select
              value={activeSupplier ?? ""}
              onChange={(e) => {
                const val = e.target.value
                const params = new URLSearchParams()
                for (const [k, v] of Object.entries(baseParams)) { if (v && k !== "page") params.set(k, v) }
                if (val) params.set("supplier", val); else params.delete("supplier")
                params.delete("page")
                const qs = params.toString()
                window.location.href = qs ? `${basePath}?${qs}` : basePath
              }}
              className="h-8 appearance-none rounded-md border border-slate-200 bg-white py-0 pl-2.5 pr-7 text-xs text-slate-600 outline-none focus:border-emerald-400"
              aria-label="Filter by supplier"
            >
              <option value="">All suppliers</option>
              {facets.suppliers.map((s) => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>From</span>
          <input
            type="date"
            defaultValue={activeFrom ?? ""}
            onChange={(e) => {
              const val = e.target.value
              const params = new URLSearchParams()
              for (const [k, v] of Object.entries(baseParams)) { if (v && k !== "page") params.set(k, v) }
              if (val) params.set("from", val); else params.delete("from")
              params.delete("page")
              window.location.href = `${basePath}?${params.toString()}`
            }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-emerald-400"
          />
          <span>to</span>
          <input
            type="date"
            defaultValue={activeTo ?? ""}
            onChange={(e) => {
              const val = e.target.value
              const params = new URLSearchParams()
              for (const [k, v] of Object.entries(baseParams)) { if (v && k !== "page") params.set(k, v) }
              if (val) params.set("to", val); else params.delete("to")
              params.delete("page")
              window.location.href = `${basePath}?${params.toString()}`
            }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      {hasActive && (
        <div className="flex flex-wrap items-center gap-2">
          {activeType && (
            <ActiveChip label={`Type: ${facets.templates.find((t) => t.id === activeType)?.name ?? activeType}`} href={buildHref(basePath, baseParams, { type: null })} />
          )}
          {activeCategory && (
            <ActiveChip label={`Category: ${activeCategory}`} href={buildHref(basePath, baseParams, { category: null })} />
          )}
          {activeSupplier && (
            <ActiveChip label={`Supplier: ${activeSupplier}`} href={buildHref(basePath, baseParams, { supplier: null })} />
          )}
          {activeFrom && (
            <ActiveChip label={`From: ${activeFrom}`} href={buildHref(basePath, baseParams, { from: null })} />
          )}
          {activeTo && (
            <ActiveChip label={`To: ${activeTo}`} href={buildHref(basePath, baseParams, { to: null })} />
          )}
          <Link
            href={buildHref(basePath, baseParams, { type: null, category: null, supplier: null, from: null, to: null, flagged: null })}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            Clear all
          </Link>
        </div>
      )}
    </div>
  )
}

function ActiveChip({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100">
      {label}
      <X className="h-3 w-3" />
    </Link>
  )
}
