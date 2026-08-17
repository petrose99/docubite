import { KeyRound, Lock, ScanEye, Server, ShieldCheck, ToggleLeft } from "lucide-react"
import Link from "next/link"

const points = [
  { icon: Lock, title: "Private encrypted storage", text: "Source documents sit in KMS-encrypted object storage. Browsers never talk to it directly — every view is streamed through the application." },
  { icon: KeyRound, title: "Workspace-scoped access", text: "Owner and member roles, per-file link sharing you can revoke, and invitations that expire on their own." },
  { icon: Server, title: "Two services, one purpose", text: "Documents go to our parsing service over TLS to be read; only the resulting text reaches the AI model. With AI off, neither is called at all." },
  { icon: ShieldCheck, title: "Nothing sensitive in the logs", text: "Document bodies, base64 payloads and prompts containing document data are never written to logs." },
  { icon: ScanEye, title: "Scanned before it's touched", text: "Every upload is malware-scanned before it is rendered, stored for viewing, or sent anywhere. In production the scan fails closed: no verdict, no processing." },
  { icon: ToggleLeft, title: "AI you can switch off", text: "A per-workspace kill switch turns off every AI call — extraction falls back to review-only, and shared links never had it to begin with." },
]

export function Security() {
  return (
    <section className="bg-emerald-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-400">Security</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              These are your clients’ documents. We treat them that way.
            </h2>
            <p className="mt-5 max-w-md leading-7 text-emerald-100/75">
              Read the <Link href="/docs/privacy_policy" className="font-medium text-emerald-300 underline underline-offset-4">privacy notice</Link> and the <Link href="/docs/ai" className="font-medium text-emerald-300 underline underline-offset-4">AI use notice</Link> for exactly what is stored, what is sent to a model, and what is not.
            </p>
          </div>

          <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {points.map((point) => (
              <div key={point.title}>
                <point.icon aria-hidden className="h-6 w-6 text-emerald-400" strokeWidth={1.6} />
                <h3 className="mt-3 font-display text-lg font-bold tracking-[-0.02em]">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-emerald-100/70">{point.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
