import config from "@/lib/config"
import { processDocumentJob, processNextQueuedDocumentJob } from "@/lib/document-processing"
import { drainWebhookDeliveries } from "@/lib/webhook-delivery"
import { drainIntegrationPushes } from "@/lib/integration-push"
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
    const webhookDeliveries = await drainWebhookDeliveries()
    const integrationPushes = await drainIntegrationPushes()
    let jobId: string | null = null
    if (body.jobId) { await processDocumentJob(body.jobId); jobId = body.jobId }
    else if (!body.drainWebhooks && !body.drainIntegrationPushes) jobId = await processNextQueuedDocumentJob()
    return Response.json({ processed: Boolean(jobId), jobId, webhookDeliveries, integrationPushes })
  } catch (error) {
    // Logged rather than swallowed: this route has no caller watching stdout except the drain
    // cron, so without this the only visibility into a failure is Vercel's function logs — and
    // they show nothing unless the error actually gets written somewhere.
    console.error("[jobs/process] drain failed:", error)
    return Response.json({ processed: false, error: "processing_failed" }, { status: 500 })
  }
}
