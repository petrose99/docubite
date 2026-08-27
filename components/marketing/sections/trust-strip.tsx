import { Marquee } from "@/components/marketing/marquee"
import { Camera, FileStack, FileText, Folder, Landmark, PenLine, Receipt, ScanLine, type LucideIcon } from "lucide-react"

/** Deliberately not fake customer logos: the product has no named references to show yet, and
 * inventing six greyed-out wordmarks is the one thing on a marketing page a finance buyer will
 * check. These are the document kinds and formats it handles, which is a claim we can stand on. */
const items: { label: string; icon: LucideIcon }[] = [
  { label: "Invoices", icon: FileText },
  { label: "Receipts", icon: Receipt },
  { label: "Bank statements", icon: Landmark },
  { label: "Handwritten notes", icon: PenLine },
  { label: "Scanned PDFs", icon: ScanLine },
  { label: "Photos", icon: Camera },
  { label: "Multi-page bundles", icon: FileStack },
  { label: "Whole folders", icon: Folder },
]

export function TrustStrip() {
  return (
    <section className="bg-cream-100">
      <div className="perforation text-cream-200" aria-hidden />
      <div className="py-8">
        <p className="text-center text-xs font-semibold uppercase tracking-[.18em] text-stone-500">Reads what your inbox actually receives</p>
        <div className="mt-5">
          <Marquee>
            {items.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-2 rounded-full border border-cream-200 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-600">
                <item.icon className="h-3.5 w-3.5 text-emerald-700" aria-hidden />{item.label}
              </span>
            ))}
          </Marquee>
        </div>
      </div>
      <div className="perforation text-cream-200" aria-hidden />
    </section>
  )
}
