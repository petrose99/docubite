import { AiBand } from "@/components/marketing/sections/ai-band"
import { CtaBand } from "@/components/marketing/sections/cta-band"
import { ExtractionCore } from "@/components/marketing/sections/extraction-core"
import { Faq } from "@/components/marketing/sections/faq"
import { FolderReport } from "@/components/marketing/sections/folder-report"
import { Hero } from "@/components/marketing/sections/hero"
import { Pricing } from "@/components/marketing/sections/pricing"
import { Provenance } from "@/components/marketing/sections/provenance"
import { RepeatingDocs } from "@/components/marketing/sections/repeating-docs"
import { Repositioning } from "@/components/marketing/sections/repositioning"
import { Security } from "@/components/marketing/sections/security"
import { Sharing } from "@/components/marketing/sections/sharing"
import { SolutionsTeaser } from "@/components/marketing/sections/solutions-teaser"
import { TrustStrip } from "@/components/marketing/sections/trust-strip"
import { Workflow } from "@/components/marketing/sections/workflow"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { absolute: "DocuBite — Turn any document into data you can trust" },
  description: "DocuBite reads invoices, receipts and bank statements — scans, photos and handwriting included — into a live sheet where every value traces to its source. Drop in a whole folder and get back the gaps, the duplicates, and what needs attention.",
}

export default function Home() {
  return <>
    <Hero />
    <TrustStrip />
    <ExtractionCore />
    <Repositioning />
    <AiBand />
    <RepeatingDocs />
    <FolderReport />
    <Workflow />
    <Provenance />
    <Sharing />
    <SolutionsTeaser />
    <Security />
    <Pricing />
    <Faq />
    <CtaBand />
  </>
}
