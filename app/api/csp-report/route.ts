import * as Sentry from "@sentry/nextjs"
import { scrubUuids } from "@/lib/sentry-scrub"

export const dynamic = "force-dynamic"

type CspReportBody = Record<string, unknown>

/** blocked-uri/document-uri/source-file are policy metadata, not document content, but they are
 * URLs and can carry a workspace/document id in the path — scrubbed the same way sentry-scrub.ts
 * scrubs every other URL that reaches Sentry. */
function scrubReport(report: CspReportBody): CspReportBody {
  const scrubbed: CspReportBody = {}
  for (const [key, value] of Object.entries(report)) scrubbed[key] = typeof value === "string" ? scrubUuids(value) : value
  return scrubbed
}

/** The browser's CSP violation reports, sent while the nonce-based script-src policy soaks in
 * Report-Only mode (see proxy.ts, lib/csp.ts) before CSP_ENFORCE=true switches it to blocking.
 *
 * No auth: the browser POSTs these itself, unauthenticated, per the CSP spec — report-uri accepts
 * whatever the UA sends. This route's only job is getting that into Sentry without also handing it
 * whatever URL the violation happened to carry unscrubbed.
 *
 * Reports land in `contexts`, not `extra` — sentry-scrub.ts's beforeSend drops `extra` outright on
 * every event, which would otherwise silently discard the one thing this route exists to report. */
export async function POST(request: Request) {
  const raw = await request.text().catch(() => "")
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    return new Response(null, { status: 204 })
  }
  if (!parsed || typeof parsed !== "object") return new Response(null, { status: 204 })

  const report = ("csp-report" in parsed ? (parsed as { "csp-report": CspReportBody })["csp-report"] : parsed) as CspReportBody
  Sentry.captureMessage("csp_violation", { level: "warning", contexts: { csp: scrubReport(report) } })

  return new Response(null, { status: 204 })
}
