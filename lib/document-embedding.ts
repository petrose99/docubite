import { chunkFromBlocks, chunkFromText, type Chunk } from "@/lib/chunking"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { documentBlocksKey, readDocumentBlocks } from "@/lib/document-storage"
import { embedTexts } from "@/lib/embeddings"
import type { BlocksSidecar } from "@/lib/provenance"
import { deleteDocumentChunks, getDocumentChunkHashes, replaceDocumentChunks, type ChunkInsert } from "@/models/document-chunks"

/** Mirrors the extract job's lease window: the embed job renews its lease between batches so a
 * long document does not have the job reclaimed as expired mid-embed. */
const JOB_LEASE_MS = 14 * 60 * 1000

/** Embed failures that will fail identically on every retry — a misconfiguration or a wrong model
 * at the endpoint — so the job is failed at once rather than burning its five attempts. Everything
 * else (timeouts, 429, 5xx) is transient and left retryable. */
const EMBED_PERMANENT_CODES = ["embeddings_not_configured", "embedding_dims_mismatch", "embeddings_auth_failed", "embeddings_bad_request"]

/** Same shape as the extract job's helper (kept local to avoid a circular import): turns an error
 * into a filesystem-safe error code for the job row. */
function safeErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : "embedding_failed"
  return raw.replace(/[^a-z0-9_]/gi, "_").slice(0, 96).toLowerCase()
}

/** The job as the dispatcher loads it (a superset is passed; only these fields are read). */
export type EmbedJobInput = {
  id: string
  attempts: number
  scheduledAt: Date
  document: {
    id: string
    workspaceId: string
    fileId: string
    ocrText: string
    workspace: { aiEnabled: boolean }
  }
}

function parseSidecar(raw: string | null): BlocksSidecar | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && (parsed as BlocksSidecar).version === 1 && Array.isArray((parsed as BlocksSidecar).blocks)) {
      return parsed as BlocksSidecar
    }
    return null
  } catch {
    return null
  }
}

async function completeJob(jobId: string) {
  await prisma.documentProcessingJob.update({ where: { id: jobId }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } })
}

async function renewLease(jobId: string) {
  await prisma.documentProcessingJob.update({ where: { id: jobId }, data: { leaseUntil: new Date(Date.now() + JOB_LEASE_MS) } })
}

/** Chunks a document's OCR output, embeds each chunk, and stores the vectors for semantic search.
 *
 * Deliberately isolated from the extract job's failure handling: this NEVER touches
 * document.status. The document is already extracted and usable for review and export; a lagging
 * or failing embed must not mark it failed. Only the job row records the outcome. */
export async function processEmbedJob(job: EmbedJobInput): Promise<void> {
  const document = job.document
  try {
    // Re-check the gates at run time: the feature could have been turned off after the job was
    // enqueued, and aiEnabled could have been toggled.
    if (!config.embeddings.enabled) throw new Error("embeddings_not_configured")
    if (!document.workspace.aiEnabled) {
      await completeJob(job.id)
      return
    }

    // Chunk from the blocks sidecar when present (it carries page/bbox provenance), else fall back
    // to splitting the flat ocrText.
    const sidecar = parseSidecar(await readDocumentBlocks(documentBlocksKey(document.workspaceId, document.id)))
    const chunks: Chunk[] = sidecar
      ? chunkFromBlocks(sidecar, config.embeddings.modelName)
      : chunkFromText(document.ocrText ?? "", config.embeddings.modelName)

    // Image-only or empty document: clear any stale chunks from a previous version and finish.
    if (!chunks.length) {
      await deleteDocumentChunks(document.workspaceId, document.id)
      await completeJob(job.id)
      return
    }

    // Hash skip: if the freshly computed chunk hashes match the stored set exactly, nothing about
    // the indexable content changed — finish without calling the embedding endpoint at all.
    const stored = await getDocumentChunkHashes(document.workspaceId, document.id)
    const fresh = chunks.map((chunk) => chunk.contentHash)
    if (stored.length === fresh.length && stored.every((hash, index) => hash === fresh[index])) {
      await completeJob(job.id)
      return
    }

    // Embed in batches, renewing the lease between them. embedTexts batches internally too; this
    // outer loop is where a very long document's chunks would otherwise outlast the lease.
    const batchSize = Math.max(1, config.embeddings.batchSize)
    const vectors: number[][] = []
    for (let start = 0; start < chunks.length; start += batchSize) {
      const slice = chunks.slice(start, start + batchSize)
      vectors.push(...(await embedTexts(slice.map((chunk) => chunk.text), "document")))
      if (start + batchSize < chunks.length) await renewLease(job.id)
    }

    const inserts: ChunkInsert[] = chunks.map((chunk, index) => ({
      chunkIndex: index,
      text: chunk.text,
      provenance: chunk.provenance,
      contentHash: chunk.contentHash,
      embedding: vectors[index],
    }))
    await replaceDocumentChunks({ workspaceId: document.workspaceId, documentId: document.id, fileId: document.fileId, chunks: inserts })
    await prisma.$transaction([
      prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } }),
      prisma.documentAuditEvent.create({ data: { workspaceId: document.workspaceId, documentId: document.id, type: "embedding_completed" } }),
    ])
  } catch (error) {
    const errorCode = safeErrorCode(error)
    const permanent = job.attempts >= 5 || EMBED_PERMANENT_CODES.includes(errorCode)
    const retryAt = new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1)))
    // Job row only — never document.status. An audit event is written on permanent failure so the
    // operator can see which documents never indexed and why.
    await prisma.$transaction([
      prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: permanent ? "failed" : "queued", errorCode, scheduledAt: permanent ? job.scheduledAt : retryAt, completedAt: permanent ? new Date() : null, leaseUntil: null } }),
      ...(permanent ? [prisma.documentAuditEvent.create({ data: { workspaceId: document.workspaceId, documentId: document.id, type: "embedding_failed" } })] : []),
    ])
    throw error
  }
}
