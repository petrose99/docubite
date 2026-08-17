import { Faq } from "@/components/marketing/sections/faq"
import { Pricing } from "@/components/marketing/sections/pricing"
import { TRIAL_DAYS } from "@/lib/plans"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple per-workspace pricing with a ${TRIAL_DAYS}-day free trial. Start on Starter, move to Growth for team workspaces, or talk to us about Enterprise.`,
}

export default function PricingPage() {
  return <>
    <Pricing eyebrow={false} />
    <Faq />
  </>
}
