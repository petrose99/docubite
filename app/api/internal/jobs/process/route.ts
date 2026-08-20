import config from "@/lib/config"
import { processDocumentJob, processNextQueuedDocumentJob } from "@/lib/document-processing"
import crypto from "crypto"

function authorized(request: Request) {
  const value = request.headers.get("authorization") || ""
  const expected = `Bearer ${config.aws.internalWorkerSecret}`
  return value.length === expected.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 })
  try {
    const body = await request.json().catch(() => ({})) as { jobId?: string }
    const jobId = body.jobId || await processNextQueuedDocumentJob()
    if (!jobId) return Response.json({ processed: false })
    if (body.jobId) await processDocumentJob(body.jobId)
    return Response.json({ processed: true, jobId })
  } catch (error) {
    // Logged rather than swallowed: this route has no caller watching stdout except the drain
    // cron, so without this the only visibility into a failure is Vercel's function logs — and
    // they show nothing unless the error actually gets written somewhere.
    console.error("[jobs/process] drain failed:", error)
    return Response.json({ processed: false, error: "processing_failed" }, { status: 500 })
  }
}
