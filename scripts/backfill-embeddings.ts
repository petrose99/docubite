import config from "@/lib/config"
import { prisma } from "@/lib/db"

/** One-off backfill: enqueues an `embed` job for every already-OCR'd document that has never been
 * indexed for semantic search. Safe to re-run — it only ever enqueues documents that have OCR text
 * (`ocrText != ""`, so a searchable body exists — the document's LLM field-extraction may even have
 * failed), no chunks yet, and no embed job already queued/processing/completed. A document that
 * completed embedding (even to zero chunks) is left alone; one whose embed job permanently FAILED
 * is re-enqueued, so re-running after fixing a misconfiguration picks the stragglers back up.
 *
 * Jobs are given a staggered `scheduledAt` (+2s apiece) so a large backfill drains steadily rather
 * than hammering the embedding endpoint all at once. The workers drain the queue from there;
 * nothing embeds inside this script.
 *
 * Run with: tsx --env-file .env scripts/backfill-embeddings.ts */

const PAGE_SIZE = 200
const STAGGER_SECONDS = 2

async function main() {
  if (!config.embeddings.enabled) {
    throw new Error("EMBEDDINGS_BASE_URL is not set — configure the embedding endpoint before backfilling, or the enqueued jobs will only fail.")
  }
  const startedAt = Date.now()
  let cursor: string | undefined
  let enqueued = 0
  for (;;) {
    const documents = await prisma.document.findMany({
      where: {
        ocrText: { not: "" },
        chunks: { none: {} },
        jobs: { none: { type: "embed", status: { in: ["queued", "processing", "completed"] } } },
      },
      select: { id: true, workspaceId: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!documents.length) break
    await prisma.documentProcessingJob.createMany({
      data: documents.map((document, index) => ({
        workspaceId: document.workspaceId,
        documentId: document.id,
        type: "embed",
        scheduledAt: new Date(startedAt + (enqueued + index) * STAGGER_SECONDS * 1000),
      })),
    })
    enqueued += documents.length
    cursor = documents[documents.length - 1].id
    console.info(`Enqueued ${enqueued} embed job(s) so far…`)
  }
  console.info(`Done. Enqueued ${enqueued} embed job(s).`)
}

main()
  .catch((error) => {
    console.error("Backfill failed", error instanceof Error ? error.message : "unknown_error")
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
