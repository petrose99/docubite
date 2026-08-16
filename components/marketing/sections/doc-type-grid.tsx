"use client"

import {
  Camera,
  ChevronDown,
  ClipboardList,
  FileCheck,
  FileSignature,
  FileText,
  FlaskConical,
  Landmark,
  Layers,
  Mail,
  Package,
  PenLine,
  Plus,
  Receipt,
  ScanLine,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"

/** Icon is a lookup key, not a component reference or rendered element — Server Components can't
 * pass functions to a Client Component as prop data, so the icon has to be resolved client-side
 * from a name the server is allowed to send (a plain string). */
const ICONS = {
  FileText,
  Receipt,
  Landmark,
  Package,
  Mail,
  FlaskConical,
  ShieldCheck,
  Truck,
  FileCheck,
  ClipboardList,
  FileSignature,
  PenLine,
  ScanLine,
  Camera,
  Layers,
} satisfies Record<string, LucideIcon>

export type DocCard = { name: string; text: string; icon: keyof typeof ICONS }

/** The card grid used for both "by document type" and "by document quality" on the solutions
 * page. `collapseAfter` keeps the long by-type list (a dozen-plus entries once every vertical
 * gets its own row) from turning the page into one long scroll — it renders behind a "Show all"
 * toggle instead of being cut down to a shorter, less complete list. */
export function DocTypeGrid({ cards, showCustomCard, collapseAfter }: { cards: DocCard[]; showCustomCard?: boolean; collapseAfter?: number }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = collapseAfter !== undefined && cards.length > collapseAfter
  const visible = collapsible && !expanded ? cards.slice(0, collapseAfter) : cards

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((card) => {
          const Icon = ICONS[card.icon]
          return (
            <a
              key={card.name}
              href="#cta"
              className="flex flex-col rounded-[1.375rem] rounded-tr-md border border-stone-200 bg-white p-5 transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(41,37,36,.5)]"
            >
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><Icon className="h-[18px] w-[18px]" /></span>
              <span className="mt-3.5 font-display text-[17px] font-bold tracking-[-0.02em] text-stone-900">{card.name}</span>
              <span className="mt-1.5 flex-1 text-[13.5px] leading-[1.5] text-stone-600">{card.text}</span>
            </a>
          )
        })}
        {showCustomCard && (
          <a
            href="#cta"
            className="flex flex-col rounded-[1.375rem] rounded-tr-md border border-dashed border-emerald-200 bg-emerald-50/40 p-5 transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(41,37,36,.5)]"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><Plus className="h-[18px] w-[18px]" /></span>
            <span className="mt-3.5 font-display text-[17px] font-bold tracking-[-0.02em] text-stone-900">Your document</span>
            <span className="mt-1.5 flex-1 text-[13.5px] leading-[1.5] text-stone-600">Define your own fields with a custom template</span>
          </a>
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 transition-colors hover:text-emerald-900"
        >
          {expanded ? "Show fewer" : "Show more"}
          <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </>
  )
}
