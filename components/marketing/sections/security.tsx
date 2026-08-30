import { Reveal } from "@/components/marketing/reveal"
import { KeyRound, Lock, ScanEye, ShieldCheck, ToggleLeft } from "lucide-react"
import Link from "next/link"

const points = [
  { icon: Lock, title: "Private encrypted storage", text: "Source documents sit in KMS-encrypted object storage. Browsers never talk to it directly — every view is streamed through the application." },
  { icon: KeyRound, title: "MFA, SSO and per-file link control", text: "Owner and member roles, per-file link sharing you can revoke, and invitations that expire on their own." },
  { icon: ShieldCheck, title: "Append-only audit trail, 6-year archival", text: "Every access and edit is logged and cannot be altered after the fact, retained for six years — the window most compliance regimes ask for." },
  { icon: ScanEye, title: "Malware-scanned before it's touched", text: "Every upload is scanned before it is rendered, stored for viewing, or sent anywhere. In production the scan fails closed: no verdict, no processing." },
  { icon: ToggleLeft, title: "AI you can switch off", text: "A per-workspace kill switch turns off every AI call — extraction falls back to review-only, and shared links never had it to begin with." },
]

/** A dark band like AiBand, but deliberately not a mirror of it: compact lock-badge chips instead
 * of a demo mock, so the two dark sections read as different kinds of content, not a repeated
 * template. id="security" is the Product mega-menu's anchor target. */
export function Security() {
  return (
    <section id="security" className="bg-emerald-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-400">Security &amp; compliance</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
            These are your clients&rsquo; documents. <span className="text-amber-300">We treat them that way.</span>
          </h2>
          <p className="mt-5 max-w-lg leading-7 text-emerald-100/75">
            Read the <Link href="/docs/privacy_policy" className="font-medium text-emerald-300 underline underline-offset-4">privacy notice</Link> and the <Link href="/docs/ai" className="font-medium text-emerald-300 underline underline-offset-4">AI use notice</Link> for exactly what is stored, what is sent to a model, and what is not.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((point, index) => (
            <Reveal key={point.title} delay={0.05 * index}>
              <div className="flex h-full gap-3 rounded-2xl rounded-tr-md border border-emerald-800 bg-emerald-900/50 p-4">
                <point.icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" strokeWidth={1.8} />
                <div>
                  <h3 className="font-display text-sm font-bold tracking-[-0.01em] text-white">{point.title}</h3>
                  <p className="mt-1 text-[0.83rem] leading-5 text-emerald-100/70">{point.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
