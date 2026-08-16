import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

/** Built on native <details>/<summary> rather than pulled in from shadcn.
 *
 * The shadcn accordion needs @radix-ui/react-accordion and has to be a client component; the FAQ
 * it is here for is static content on a marketing page. The native element gives the same
 * keyboard behaviour, screen-reader semantics and open/closed state for no JavaScript and no new
 * dependency — matching the reasoning already applied to components/ui/native-select.tsx. */
export function Accordion({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-stone-200 border-y border-stone-200", className)}>{children}</div>
}

export function AccordionItem({ question, children, defaultOpen = false }: { question: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left font-display text-lg font-semibold tracking-[-0.01em] text-stone-900 hover:text-emerald-800 [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-emerald-700 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="max-w-3xl pb-5 leading-7 text-stone-600">{children}</div>
    </details>
  )
}
