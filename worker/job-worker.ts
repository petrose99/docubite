import { processNextQueuedDocumentJob } from "@/lib/document-processing"

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
    if (jobId) console.log("Processed job", jobId)
    else await sleep(IDLE_DELAY_MS)
  }
}

run().catch(() => process.exit(1))
