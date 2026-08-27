import { CtaBand } from "@/components/marketing/sections/cta-band"
import { Faq } from "@/components/marketing/sections/faq"
import { Hero } from "@/components/marketing/sections/hero"
import { ModeChooser } from "@/components/marketing/sections/mode-chooser"
import { Security } from "@/components/marketing/sections/security"
import { TrustStrip } from "@/components/marketing/sections/trust-strip"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { absolute: "DocuBite — Turn documents and dictation into data you can trust" },
  description: "DocuBite reads invoices, receipts and bank statements — scans, photos and handwriting included — into a live sheet where every value traces to its source. No document to scan? Dictate it instead and get back a proper report, not just a transcript.",
}

/** The light chooser WP6 asks for: a visitor picks accounting or clinical here, then gets the
 * deep pitch on its own page (app/(marketing)/accounting, app/(marketing)/clinical) — this used
 * to carry every section for both at once, which is exactly the mixed positioning the split
 * exists to fix. */
export default function Home() {
  return <>
    <Hero />
    <TrustStrip />
    <ModeChooser />
    <Security />
    <Faq />
    <CtaBand />
  </>
}
