import { CtaBand } from "@/components/marketing/sections/cta-band"
import { DictationPitch } from "@/components/marketing/sections/dictation-pitch"
import { Faq } from "@/components/marketing/sections/faq"
import { Hero } from "@/components/marketing/sections/hero"
import { Provenance } from "@/components/marketing/sections/provenance"
import { Security } from "@/components/marketing/sections/security"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "DocuBite for clinical documentation",
  description: "Dictate a case and get back a proper report, not just a transcript — every value provenanced to the exact moment it was said. HIPAA mode, BAA-covered, demo-led.",
}

/** The clinical pitch: dictation-first, demo/talk-to-us rather than self-serve — a signed BAA has
 * to exist before a workspace may even use external ASR at all (lib/asr/gating.ts), so there is
 * no honest "start free trial" button to put here. */
export default function ClinicalPage() {
  return <>
    <Hero variant="clinical" />
    <DictationPitch />
    <Provenance />
    <Security />
    <Faq />
    <CtaBand />
  </>
}
