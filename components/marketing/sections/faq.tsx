import { Accordion, AccordionItem } from "@/components/ui/accordion"
import { TRIAL_DAYS } from "@/lib/plans"
import Link from "next/link"

export function Faq() {
  return (
    <section className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">Questions people ask first</h2>
          <p className="mt-4 leading-7 text-stone-600">
            Anything else, <Link href="/demo" className="font-medium text-emerald-800 underline underline-offset-4">book a demo</Link> and ask it live.
          </p>
        </div>

        <Accordion>
          <AccordionItem question="Is DocuBite accounting software?" defaultOpen>
            No, and deliberately so. There is no ledger, no reconciliation, no invoice generator and no automatic posting. DocuBite extracts, reviews, searches and exports — the bookkeeping stays wherever you already do it.
          </AccordionItem>
          <AccordionItem question="What happens to a document the AI cannot read?">
            Scans, photographs and handwriting go through the same document parser as clean print, so an image-only page is read rather than skipped. Fields the model is unsure about arrive flagged for review rather than silently filled in.
          </AccordionItem>
          <AccordionItem question="Can I capture fields that are specific to my practice?">
            Yes. Alongside the invoice and receipt templates you can define your own template with stable field keys, labels, types and extraction instructions, including repeating item tables.
          </AccordionItem>
          <AccordionItem question="Do my documents get used to train a model?">
            No. A document goes to our parsing service to be turned into text, and only that text is sent to the configured model to structure that one document. See the <Link href="/docs/ai" className="font-medium text-emerald-800 underline underline-offset-4">AI use notice</Link>.
          </AccordionItem>
          <AccordionItem question={`What is included in the ${TRIAL_DAYS}-day trial?`}>
            The full product, no credit card. Add a payment method whenever you are ready; if the trial ends first, your data stays exactly where it is and you pick a plan to carry on.
          </AccordionItem>
          <AccordionItem question="Can my team work in the same workspace?">
            Team workspaces with owner and member roles are on the Growth plan and above. Every plan includes per-file link sharing for people outside the workspace.
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  )
}
