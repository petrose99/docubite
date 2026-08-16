import { EmailCapture } from "@/components/marketing/email-capture"
import { TRIAL_DAYS } from "@/lib/plans"
import Link from "next/link"

export function CtaBand() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] sm:text-[2.6rem] sm:leading-[1.08]">
            Your inbox is full of documents. Let something else read them.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-emerald-100/75">
            Start a {TRIAL_DAYS}-day free trial and put your worst-looking document through it first.
          </p>
          <EmailCapture size="lg" tone="inverse" className="mx-auto mt-8 max-w-lg" />
          <p className="mt-4 text-sm text-emerald-100/60">
            No credit card required ·{" "}
            <Link href="/demo" className="font-medium text-emerald-300 underline underline-offset-4">Book a demo instead</Link>
          </p>
        </div>
      </div>
    </section>
  )
}
