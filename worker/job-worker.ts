import { processNextQueuedDocumentJob } from "@/lib/document-processing"
import { processNextWebhookDelivery } from "@/lib/webhook-delivery"

const IDLE_DELAY_MS = 5_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run() {
  console.log("Job worker starting…")
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
    if (!jobId && !deliveryId) await sleep(IDLE_DELAY_MS)
  }
}

run().catch(() => process.exit(1))
