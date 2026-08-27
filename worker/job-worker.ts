import { sweepOldProductEvents } from "@/lib/analytics"
import { processNextQueuedDocumentJob } from "@/lib/document-processing"
import { processNextWebhookDelivery } from "@/lib/webhook-delivery"
import { verifyProductionConfig } from "@/lib/verify-production-config"

const IDLE_DELAY_MS = 5_000
/** How often the analytics retention sweep runs. Once an hour, not every idle tick: a DELETE
 * against product_events costs nothing at this table's size today, but there is no reason to pay
 * it dozens of times a minute when the data it is clearing out is 90 days stale either way. */
const ANALYTICS_SWEEP_INTERVAL_MS = 60 * 60_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run() {
  verifyProductionConfig()
  console.log("Job worker starting…")
  let lastSweepAt = 0
  for (;;) {
    const jobId = await processNextQueuedDocumentJob().catch((error) => {
      console.error("Job worker failed", error instanceof Error ? error.message : "unknown_error")
      return null
    })
    // Drain one webhook delivery per iteration alongside document jobs. "Either did work" keeps the
    // loop hot; only a fully idle pass sleeps, so neither queue starves the other.
    const deliveryId = await processNextWebhookDelivery().catch((error) => {
      console.error("Webhook delivery failed", error instanceof Error ? error.message : "unknown_error")
      return null
    })
    if (jobId) console.log("Processed job", jobId)
    if (deliveryId) console.log("Delivered webhook", deliveryId)
    if (Date.now() - lastSweepAt >= ANALYTICS_SWEEP_INTERVAL_MS) {
      lastSweepAt = Date.now()
      await sweepOldProductEvents().then((deleted) => { if (deleted) console.log("Swept stale analytics events", deleted) })
        .catch((error) => console.error("Analytics sweep failed", error instanceof Error ? error.message : "unknown_error"))
    }
    if (!jobId && !deliveryId) await sleep(IDLE_DELAY_MS)
  }
}

run().catch(() => process.exit(1))
