import { cn } from "@/lib/utils"

/** The brand mark: a document with a circular bite taken out of its top-right corner.
 *
 * The bite is cut into the outline as a concave arc rather than punched with an SVG <mask>. A
 * mask needs an id, and this mark renders several times on one page (nav, footer, auth card,
 * sidebar) — duplicate ids in a server component, which cannot call useId, would be a latent
 * collision. Pure geometry has no such problem and paints correctly over any background. */
export function BiteMark({ className, tone = "brand" }: { className?: string; tone?: "brand" | "inverse" }) {
  const document = tone === "inverse" ? "fill-white" : "fill-emerald-700"
  const ink = tone === "inverse" ? "fill-emerald-700" : "fill-white"
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="DocuBite" className={className}>
      <path
        className={document}
        d="M9 3 L20.5 3 A6.5 6.5 0 0 0 27 9.5 L27 25 A4 4 0 0 1 23 29 L9 29 A4 4 0 0 1 5 25 L5 7 A4 4 0 0 1 9 3 Z"
      />
      {/* The crumb: the piece that was bitten off, floating clear of the page. */}
      <circle className={document} cx="29.4" cy="13.6" r="1.5" />
      <rect className={ink} x="9.5" y="14" width="13" height="2.4" rx="1.2" />
      <rect className={ink} x="9.5" y="19.5" width="8.5" height="2.4" rx="1.2" />
    </svg>
  )
}

/** Mark plus wordmark. `tone="inverse"` is for the deep-emerald sections and the footer. */
export function Logo({ className, tone = "brand", markClassName }: { className?: string; tone?: "brand" | "inverse"; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BiteMark tone={tone} className={cn("h-7 w-7 shrink-0", markClassName)} />
      <span className={cn("font-display text-[1.35rem] font-bold leading-none tracking-[-0.03em]", tone === "inverse" ? "text-white" : "text-stone-900")}>
        DocuBite
      </span>
    </span>
  )
}
