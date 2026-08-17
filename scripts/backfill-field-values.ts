import { flattenDocumentValues } from "@/lib/document-values"
import { parseTemplateFields } from "@/lib/document-templates"
import { searchableText } from "@/models/documents"
import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"

/** One-off, idempotent backfill for the queryable extracted-data layer. Rebuilds every existing
 * document's flattened DocumentFieldValue rows from its own field snapshot and extracted data, so
 * documents that predate the sync (A4) become searchable and aggregatable on /data.
 *
 * Also repairs the historic searchText bug: extraction never updated searchText, so any document
 * whose searchText is still exactly its filename gets it rewritten from the extracted values.
 *
 * Run with the dev server stopped (pglite accepts exactly one connection):
 *   npx tsx --env-file .env scripts/backfill-field-values.ts
 * Fresh environments need nothing — there is no data to backfill. Re-running is a plain replace. */

const BATCH_SIZE = 100

async function main() {
  let cursor: string | undefined
  let scanned = 0
  let valuesRewritten = 0
  let searchTextRepaired = 0

  for (;;) {
    const documents = await prisma.document.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, workspaceId: true, filename: true, searchText: true, fieldSnapshot: true, reviewedData: true, rawExtraction: true },
    })
    if (!documents.length) break
    cursor = documents[documents.length - 1].id

    for (const document of documents) {
      scanned++
      const data = (document.reviewedData ?? document.rawExtraction ?? {}) as Record<string, unknown>
      const source = data && typeof data === "object" && !Array.isArray(data) ? data : {}

      let rows: ReturnType<typeof flattenDocumentValues> = []
      try {
        rows = flattenDocumentValues(parseTemplateFields(document.fieldSnapshot), source)
      } catch {
        // A legacy or malformed snapshot: clear stale rows and move on, never abort the backfill.
        rows = []
      }

      const ops: Prisma.PrismaPromise<unknown>[] = [
        prisma.documentFieldValue.deleteMany({ where: { documentId: document.id } }),
      ]
      if (rows.length) {
        ops.push(prisma.documentFieldValue.createMany({
          data: rows.map((row) => ({
            workspaceId: document.workspaceId,
            documentId: document.id,
            fieldKey: row.fieldKey,
            itemKey: row.itemKey,
            itemIndex: row.itemIndex,
            label: row.label,
            type: row.type,
            valueText: row.valueText,
            valueNumber: row.valueNumber,
            valueDate: row.valueDate ? new Date(`${row.valueDate}T00:00:00.000Z`) : null,
            valueBool: row.valueBool,
          })),
        }))
      }

      // Repair searchText only where it is still the bare filename but data exists — never clobber a
      // searchText that already reflects a review.
      const rebuilt = searchableText(source, document.filename)
      if (document.searchText === document.filename && rebuilt !== document.filename) {
        ops.push(prisma.document.update({ where: { id: document.id }, data: { searchText: rebuilt } }))
        searchTextRepaired++
      }

      await prisma.$transaction(ops)
      if (rows.length) valuesRewritten++
    }

    console.info(`… ${scanned} documents scanned`)
  }

  console.info(`Backfill complete: ${scanned} documents scanned, ${valuesRewritten} with field values written, ${searchTextRepaired} searchText repaired.`)
}

main()
  .catch((error) => {
    console.error("Backfill failed", error instanceof Error ? error.message : "unknown_error")
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
