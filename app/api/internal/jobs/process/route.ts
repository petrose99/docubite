import config from "@/lib/config"
import { processDocumentJob, processNextQueuedDocumentJob } from "@/lib/document-processing"
import { drainWebhookDeliveries } from "@/lib/webhook-delivery"
import { drainIntegrationPushes } from "@/lib/integration-push"
import { syncDueLedgerConnections } from "@/lib/health/sync"
import { drainProvisionJobs } from "@/models/bigcapital"
import { runDueHealthChecks } from "@/models/health"
import { sendDueReminders } from "@/models/reminders"
import crypto from "crypto"

function authorized(request: Request) {
  const value = request.headers.get("authorization") || ""
  const expected = `Bearer ${config.aws.internalWorkerSecret}`
  return value.length === expected.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 })
  try {
    // `drainWebhooks`/`drainIntegrationPushes: true` mark a post-emit kick that should only flush
    // that one queue and not also claim a document job. The cron (empty body) drains ALL THREE
    // queues, so no cron reconfiguration was needed to start delivering webhooks, and none is
    // needed now to start pushing to accounting connectors either.
    const body = await request.json().catch(() => ({})) as { jobId?: string; drainWebhooks?: boolean; drainIntegrationPushes?: boolean }
    // Run every independent drain concurrently rather than one after another — they touch separate
    // tables and have no ordering dependency. Provisioning is skipped entirely on a targeted
    // {jobId} dispatch (the embed-detached kick after one document's OCR/ASR step): unlike the
    // other two queues, one due provisioning attempt can genuinely block for 15+ seconds (org-build
    // polling — see models/bigcapital.ts), which would delay that document's own job for no reason
    // a single-document caller asked for. The cron's empty-body hit still drains it normally.
    const [webhookDeliveries, integrationPushes, provisionJobs, reminders, ledgerSyncs, healthChecksRun] = await Promise.all([
      drainWebhookDeliveries(),
      drainIntegrationPushes(),
      body.jobId ? Promise.resolve(0) : drainProvisionJobs(),
      // Dext-parity Phase 3 WP3.4: reminders are cheap and self-rate-limiting (isReminderDue is
      // what actually decides whether anything sends), so this drains on every hit exactly like
      // the queues above — no separate cron wiring needed for reminders to start going out.
      sendDueReminders(),
      // Data Health Phase B: both of these are staleness-gated (24h since last ledger sync; once
      // per calendar day for the health-check + score snapshot pass), same reasoning as
      // provisionJobs for skipping them on a targeted {jobId} dispatch — a single document's
      // OCR/ASR completion kick has no reason to wait on a provider round-trip or a whole
      // workspace's worth of checks. The cron's empty-body hit still drains both normally.
      body.jobId ? Promise.resolve(0) : syncDueLedgerConnections(),
      body.jobId ? Promise.resolve(0) : runDueHealthChecks(),
    ])
    let jobId: string | null = null
    if (body.jobId) { await processDocumentJob(body.jobId); jobId = body.jobId }
    else if (!body.drainWebhooks && !body.drainIntegrationPushes) jobId = await processNextQueuedDocumentJob()
    return Response.json({ processed: Boolean(jobId), jobId, webhookDeliveries, integrationPushes, provisionJobs, reminders, ledgerSyncs, healthChecksRun })
  } catch (error) {
    // Logged rather than swallowed: this route has no caller watching stdout except the drain
    // cron, so without this the only visibility into a failure is Vercel's function logs — and
    // they show nothing unless the error actually gets written somewhere.
    console.error("[jobs/process] drain failed:", error)
    return Response.json({ processed: false, error: "processing_failed" }, { status: 500 })
  }
}
