import { CtaBand } from "@/components/marketing/sections/cta-band"
import { Faq } from "@/components/marketing/sections/faq"
import { Hero } from "@/components/marketing/sections/hero"
import { Security } from "@/components/marketing/sections/security"
import { SolutionsTeaser } from "@/components/marketing/sections/solutions-teaser"
import { Stats } from "@/components/marketing/sections/stats"
import { Testimonials } from "@/components/marketing/sections/testimonials"
import { TrustStrip } from "@/components/marketing/sections/trust-strip"
import { Workflow } from "@/components/marketing/sections/workflow"

export default function Home() {
  return <>
    <Hero />
    <TrustStrip />
    <Stats />
    <Workflow />
    <SolutionsTeaser />
    <Testimonials />
    <Security />
    <Faq />
    <CtaBand />
  </>
}
