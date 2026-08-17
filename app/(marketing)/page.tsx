import { AiBand } from "@/components/marketing/sections/ai-band"
import { CtaBand } from "@/components/marketing/sections/cta-band"
import { ExtractionCore } from "@/components/marketing/sections/extraction-core"
import { Faq } from "@/components/marketing/sections/faq"
import { Hero } from "@/components/marketing/sections/hero"
import { Pricing } from "@/components/marketing/sections/pricing"
import { Provenance } from "@/components/marketing/sections/provenance"
import { RepeatingDocs } from "@/components/marketing/sections/repeating-docs"
import { Repositioning } from "@/components/marketing/sections/repositioning"
import { Security } from "@/components/marketing/sections/security"
import { SolutionsTeaser } from "@/components/marketing/sections/solutions-teaser"
import { TrustStrip } from "@/components/marketing/sections/trust-strip"
import { Workflow } from "@/components/marketing/sections/workflow"

export default function Home() {
  return <>
    <Hero />
    <TrustStrip />
    <ExtractionCore />
    <Repositioning />
    <AiBand />
    <RepeatingDocs />
    <Workflow />
    <Provenance />
    <SolutionsTeaser />
    <Security />
    <Pricing />
    <Faq />
    <CtaBand />
  </>
}
