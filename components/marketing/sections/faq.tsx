import { Accordion, AccordionItem } from "@/components/ui/accordion"
import { TRIAL_DAYS } from "@/lib/plans"
import Link from "next/link"

export function Faq() {
  return (
    <section className="border-t border-cream-200 bg-cream-50">
      <div className="perforation text-cream-200" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-stone-950 sm:text-5xl">
            Questions people <span className="text-emerald-600">ask first</span>
          </h2>
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
          <AccordionItem question="What can someone I share a link with do?">
            Whatever level you pick: view, interact, or edit — per public link or per email address, no account needed on their end. Interact is a sandbox: a live grid they can explore where nothing is ever saved. <span className="font-mono">=AI()</span> is disabled on shared links, so a visitor can&apos;t spend your AI allowance.
          </AccordionItem>
          <AccordionItem question="What counts against the AI allowance?">
            Extracting a document and asking the assistant do. The folder report doesn&apos;t — it&apos;s deterministic and free. Recognising a repeat document by its shape doesn&apos;t either; the match happens before any AI runs. Cached <span className="font-mono">=AI()</span> answers recalculate for free.
          </AccordionItem>
          <AccordionItem question="What files can I upload?">
            PDF, JPEG, PNG, WebP and HEIC, up to 50&nbsp;MB each, up to 100 files in a batch — including a whole folder dragged in at once. Email-in and cloud-drive imports aren&apos;t available yet.
          </AccordionItem>
          <AccordionItem question="What can I dictate?">
            Anything free-form — a finance note, a pathology read, a delivery update, a to-do, a quick email draft. There&apos;s no format to pick first: the recording is routed to the right report automatically, with a synoptic block of extracted fields alongside it.
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  )
}
