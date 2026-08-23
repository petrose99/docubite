import { KeyRound, Link2, Lock, Share2, ToggleLeft } from "lucide-react"
import Link from "next/link"

const levels = [
  { label: "View", note: "read only", selected: false },
  { label: "Interact", note: "live grid, edits never saved", selected: true },
  { label: "Edit", note: "full access", selected: false },
  { label: "Off", note: "", selected: false },
]

const securityPoints = [
  { icon: Lock, title: "Encrypted storage", text: "Source documents sit in KMS-encrypted object storage. Browsers never talk to it directly." },
  { icon: KeyRound, title: "Workspace-scoped access", text: "Owner and member roles, per-file link sharing you can revoke." },
  { icon: ToggleLeft, title: "A kill switch for AI", text: "Turn off every AI call per workspace — extraction falls back to review-only." },
]

/** Merges the old Sharing and Security sections into one dark band: two adjacent topics on
 * "who sees your documents" made two full sections apart is one idea told twice. Sharing keeps
 * its share-dialog mock; Security is condensed from 6 points to 3 plus the policy links. */
export function ShareSecurity() {
  return (
    <section className="bg-emerald-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-400">Sharing &amp; security</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
          Share the sheet. Keep control of the documents.
        </h2>

        <div className="mt-12 grid gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="max-w-lg text-lg leading-7 text-emerald-100/75">
              Send a link — no account needed on their end. &ldquo;Interact&rdquo; gives them a live grid to total and formula over where nothing they do is ever saved, and <span className="font-mono">=AI()</span> is off so a visitor can&apos;t spend your credits.
            </p>

            <div className="mt-8 overflow-hidden rounded-[1.4rem] rounded-tr-md border border-emerald-400/20 bg-emerald-900/60">
              <div className="flex items-center gap-2 border-b border-emerald-400/15 px-3.5 py-2.5">
                <Share2 className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-sm font-semibold text-emerald-100">Share · Q1 utilities</span>
              </div>
              <div className="flex items-center gap-2 border-b border-emerald-400/15 bg-emerald-950/40 px-3.5 py-2.5">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-300/70" />
                <span className="truncate font-mono text-xs text-emerald-100/60">docubite.app/s/q1-utilities-8f2a</span>
                <span className="ml-auto shrink-0 rounded-md border border-emerald-400/25 px-2 py-1 text-xs font-semibold text-emerald-200">Copy</span>
              </div>
              <div className="divide-y divide-emerald-400/10 p-2">
                {levels.map((level) => (
                  <div
                    key={level.label}
                    className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 ${level.selected ? "bg-emerald-400/10" : ""}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${level.selected ? "border-emerald-300" : "border-emerald-400/30"}`}>
                      {level.selected && <span className="h-2 w-2 rounded-full bg-emerald-300" />}
                    </span>
                    <span className={`text-sm font-semibold ${level.selected ? "text-emerald-100" : "text-emerald-100/70"}`}>{level.label}</span>
                    {level.note && <span className="text-xs text-emerald-100/50">— {level.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="max-w-md text-lg leading-7 text-emerald-100/75">
              These are your clients&apos; documents. Read the{" "}
              <Link href="/docs/privacy_policy" className="font-medium text-emerald-300 underline underline-offset-4">privacy notice</Link> and the{" "}
              <Link href="/docs/ai" className="font-medium text-emerald-300 underline underline-offset-4">AI use notice</Link> for exactly what is stored and what is sent to a model.
            </p>

            <div className="mt-8 space-y-6">
              {securityPoints.map((point) => (
                <div key={point.title} className="flex gap-4">
                  <point.icon aria-hidden className="h-5 w-5 shrink-0 text-emerald-400" strokeWidth={1.6} />
                  <div>
                    <h3 className="font-display text-lg font-bold tracking-[-0.02em]">{point.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-emerald-100/70">{point.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
