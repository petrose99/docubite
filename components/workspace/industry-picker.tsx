"use client"

import { INDUSTRIES, modulesForIndustry } from "@/lib/modules"
import type { Industry } from "@/types/industry"

/** The 5-industry card set: shared by /workspaces/new (a brand-new user's first choice) and the
 * team-workspace creation form and settings toggle (components/workspace/industry-toggle.tsx),
 * so "what picking an industry gets you" only has one description to keep in sync with
 * lib/modules's registry. Each card's chips are that industry's own "default" and "always"-tier
 * modules a member would actually notice — optional modules aren't chip-worthy since nothing
 * changes about the workspace until someone opts into one from the catalog. */
export function IndustryPicker({ value, onChange, disabled }: {
  value: Industry
  onChange: (industry: Industry) => void
  disabled?: boolean
}) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {INDUSTRIES.map((option) => {
      const chips = modulesForIndustry(option.key).filter((module) => module.industry !== "core" && module.tier !== "optional")
      const selected = value === option.key
      return <button
        key={option.key}
        type="button"
        disabled={disabled}
        onClick={() => onChange(option.key)}
        aria-pressed={selected}
        className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-emerald-700 bg-emerald-50" : "hover:bg-stone-50"}`}
      >
        <span className="font-semibold text-stone-900">{option.label}</span>
        <span className="text-sm text-muted-foreground">{option.description}</span>
        {chips.length > 0 && <div className="mt-1 flex flex-wrap gap-1">
          {chips.map((module) => (
            <span key={module.key} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{module.name}</span>
          ))}
        </div>}
      </button>
    })}
  </div>
}
