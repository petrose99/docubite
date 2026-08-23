import { AiBand } from "@/components/marketing/sections/ai-band"
import { CtaBand } from "@/components/marketing/sections/cta-band"
import { EmailCapture } from "@/components/marketing/email-capture"
import { ExtractionCore } from "@/components/marketing/sections/extraction-core"
import { Faq } from "@/components/marketing/sections/faq"
import { FolderReport } from "@/components/marketing/sections/folder-report"
import { Hero } from "@/components/marketing/sections/hero"
import { Pricing } from "@/components/marketing/sections/pricing"
import { Provenance } from "@/components/marketing/sections/provenance"
import { RepeatingDocs } from "@/components/marketing/sections/repeating-docs"
import { ShareSecurity } from "@/components/marketing/sections/share-security"
import { SolutionsTeaser } from "@/components/marketing/sections/solutions-teaser"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { absolute: "DocuBite — Turn any document into a spreadsheet you can check" },
  description: "DocuBite reads invoices, receipts, bank statements, scans, photos and handwriting into a live sheet where every value traces to its source. Drop in a whole folder and get back the gaps, the duplicates, and what needs attention.",
}

// Mid-page conversion point: the hero and the closing CTA band are the only other places to
// convert, roughly 10 sections apart. This gives a skimmer who stops partway a way in.
function MidCta() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-14 text-center">
        <p className="font-display text-xl font-bold tracking-[-0.02em] text-stone-950">Ready to try it on your own documents?</p>
        <EmailCapture size="default" className="mx-auto mt-5 max-w-md" />
      </div>
    </section>
  )
}

export default function Home() {
  return <>
    <Hero />
    <ExtractionCore />
    <Provenance />
    <AiBand />
    <FolderReport />
    <MidCta />
    <RepeatingDocs />
    <ShareSecurity />
    <SolutionsTeaser />
    <Pricing />
    <Faq />
    <CtaBand />
  </>
}
