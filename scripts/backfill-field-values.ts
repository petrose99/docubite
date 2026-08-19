import { prisma } from "@/lib/db"
import { parseTemplateFields } from "@/lib/document-templates"
import { projectDocumentFields } from "@/lib/field-projection"
import type { DocumentProvenance } from "@/lib/provenance"
import { replaceDocumentFieldValues } from "@/models/document-field-values"

/** One-off backfill: projects every already-extracted document into document_field_values, so the
 * structured spine covers documents that predate it rather than only new uploads.
 *
 * Unlike the embeddings backfill this does the work inline instead of enqueueing jobs — there is no
 * external service to rate-limit, the projection is a pure function of data already in the row, and
 * the whole pass is a few hundred small writes.
 *
 * Safe to re-run: replaceDocumentFieldValues deletes a document's rows before inserting, so a
 * second run converges to the same state rather than duplicating. Documents with no extracted
 * values yet (queued, failed, or AI-disabled) are skipped, and a document whose fieldSnapshot no
 * longer parses is reported and skipped rather than aborting the run.
 *
 * Values come from reviewedData, falling back to rawExtraction — the same precedence the rest of
 * the app uses. Source is "llm_structured" throughout: this backfill cannot tell which fields were
 * later hand-edited, and marking edited values "manual" would be a guess. Anything genuinely edited
 * after this run re-projects itself with the right source through updateDocumentField.
 *
 * Run with: tsx --env-file .env scripts/backfill-field-values.ts */

const PAGE_SIZE = 100

async function main() {
  let cursor: string | undefined
  let scanned = 0
  let projected = 0
  let rowsWritten = 0
  let skipped = 0
  const failures: string[] = []

  for (;;) {
    const documents = await prisma.document.findMany({
      // No JSON-null filter in the query: Prisma distinguishes DB null from JSON null here, and the
      // in-loop "no extracted values" skip below covers both cases anyway.
      select: { id: true, workspaceId: true, fileId: true, fieldSnapshot: true, reviewedData: true, rawExtraction: true, confidence: true, provenance: true, template: { select: { code: true } } },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!documents.length) break
    cursor = documents[documents.length - 1].id

    for (const document of documents) {
      scanned++
      const values = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
      if (!Object.keys(values).length) { skipped++; continue }
      try {
        const fields = parseTemplateFields(document.fieldSnapshot)
        const confidence = ((document.confidence as Record<string, unknown> | null)?.fieldConfidence as Record<string, number> | null) ?? null
        const rows = projectDocumentFields({ fields, values, confidence, provenance: document.provenance as DocumentProvenance | null, source: "llm_structured" })
        await replaceDocumentFieldValues({ workspaceId: document.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows })
        projected++
        rowsWritten += rows.length
      } catch (error) {
        failures.push(`${document.id}: ${error instanceof Error ? error.message : "unknown_error"}`)
      }
    }
    console.info(`Scanned ${scanned}, projected ${projected} document(s), ${rowsWritten} value row(s) so far…`)
  }

  console.info(`Done. Scanned ${scanned}; projected ${projected} document(s) into ${rowsWritten} value row(s); skipped ${skipped} with no extracted values.`)
  if (failures.length) {
    console.warn(`${failures.length} document(s) could not be projected:`)
    for (const failure of failures) console.warn(`  ${failure}`)
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed", error instanceof Error ? error.message : "unknown_error")
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
