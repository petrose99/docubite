import { AiBand } from "@/components/marketing/sections/ai-band"
import { CtaBand } from "@/components/marketing/sections/cta-band"
import { ExtractionCore } from "@/components/marketing/sections/extraction-core"
import { Faq } from "@/components/marketing/sections/faq"
import { FolderReport } from "@/components/marketing/sections/folder-report"
import { Hero } from "@/components/marketing/sections/hero"
import { IntegrationsApi } from "@/components/marketing/sections/integrations-api"
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
  title: { absolute: "DocuBite — Turn documents into data you can trust" },
  description: "DocuBite reads invoices, receipts and bank statements — scans, photos and handwriting included — into a live sheet where every value traces to its source. Self-serve, no credit card required.",
}

/** The app is finance-only, so the homepage carries the same pitch the old /accounting page did —
 * there is no other mode to choose. */
export default function Home() {
  return <>
    <Hero variant="accounting" />
    <TrustStrip />
    <ExtractionCore />
    <Repositioning />
    <AiBand />
    <RepeatingDocs />
    <FolderReport />
    <Workflow />
    <Provenance />
    <Sharing />
    <IntegrationsApi />
    <SolutionsTeaser />
    <Security />
    <Faq />
    <CtaBand />
  </>
}
