import { prisma } from "@/lib/db"
import type { FieldValueRow } from "@/lib/field-projection"
import type { Prisma } from "@/prisma/client"

/** The structured-spine store. Hand-written SQL for the same reason document_chunks is: the
 * generated `value_text_norm` column cannot be expressed through Prisma, and the filter language
 * below compiles to correlated EXISTS clauses that Prisma's query API cannot build.
 *
 * Every statement is produced by a pure function that returns its text and ordered bind params, so
 * the SQL can be asserted in a unit test without a database. Every value — including field keys —
 * is a bind; nothing is interpolated into the SQL text. workspace_id is bound in EVERY statement,
 * so a filter can never be widened past one workspace by a caller. */

/** A built statement: parameterised SQL and its ordered bind values, run via $queryRawUnsafe. */
export type Sql = { text: string; params: unknown[] }

/** Rows per INSERT. A 200-line invoice projects to ~800 rows, so batching keeps that a handful of
 * statements rather than one enormous one. */
const INSERT_BATCH = 100

/** Safety cap on a completeness query. The point of this table is answers that are not top-k
 * truncated, so the cap is set far above any real answer; a result that reaches it is reported as
 * truncated rather than silently trimmed, which is the failure mode we are trying to avoid. */
export const MAX_MATCH_ROWS = 5000

// ---- Filter language ---------------------------------------------------------------------------

/** Comparison operators. `exists` matches a document that reported the field at all, whatever its
 * value — the completeness question ("which of these are missing an accession number?") inverted. */
export type FieldFilterOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "exists"

/** One condition on a document's extracted values.
 *
 * `itemKey` narrows to a field inside an array row: {fieldKey: "line_items", itemKey: "sku"}. A
 * filter with no itemKey matches scalar rows only, so an array field and a scalar of the same name
 * can never bleed into each other.
 *
 * Semantics are per DOCUMENT, not per row: `eq` means "this document has such a value" and `neq`
 * means "this document has no such value". That distinction matters for arrays — an invoice with
 * ten SKUs is not "not SKU-1" merely because nine of its lines are something else. */
export type FieldFilter = {
  fieldKey: string
  itemKey?: string | null
  op: FieldFilterOp
  value?: string | number | boolean | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Which typed column a filter's value should be compared against, inferred from the value's own
 * runtime type. The projection wrote the value into exactly one column by its declared type, so
 * comparing a number against value_number (and never against text) keeps the index usable. */
function comparisonColumn(value: unknown): { column: string; cast: string; bound: unknown } | null {
  if (typeof value === "number" && Number.isFinite(value)) return { column: `"value_number"`, cast: "::double precision", bound: value }
  if (typeof value === "boolean") return { column: `"value_bool"`, cast: "", bound: value }
  if (typeof value === "string" && ISO_DATE.test(value)) return { column: `"value_date"`, cast: "::date", bound: value }
  if (typeof value === "string") return { column: `"value_text_norm"`, cast: "", bound: value.trim().toLowerCase() }
  return null
}

const RANGE_OPS: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=" }

/** Compiles one filter's inner condition (everything inside the EXISTS, after the correlation and
 * workspace scope). Returns null for a filter that cannot be expressed — an unknown operator, or a
 * value of the wrong shape — so a malformed filter drops out rather than matching everything. */
function filterCondition(filter: FieldFilter, bind: (value: unknown) => string): string | null {
  const scope = [
    `v."field_key" = ${bind(filter.fieldKey)}`,
    filter.itemKey ? `v."item_key" = ${bind(filter.itemKey)}` : `v."item_key" IS NULL`,
  ]
  if (filter.op === "exists") return scope.join(" AND ")

  if (filter.op === "contains") {
    if (typeof filter.value !== "string" || !filter.value.trim()) return null
    // Escaped so a value containing % or _ matches those characters literally rather than acting
    // as a wildcard the caller never asked for.
    const escaped = filter.value.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)
    return [...scope, `v."value_text_norm" LIKE ${bind(`%${escaped}%`)} ESCAPE '\\'`].join(" AND ")
  }

  const comparison = comparisonColumn(filter.value)
  if (!comparison) return null
  if (filter.op === "eq" || filter.op === "neq") {
    return [...scope, `v.${comparison.column} = ${bind(comparison.bound)}${comparison.cast}`].join(" AND ")
  }
  const operator = RANGE_OPS[filter.op]
  if (!operator) return null
  // A range on text would compare alphabetically, which is never what a caller means.
  if (comparison.column === `"value_text_norm"` || comparison.column === `"value_bool"`) return null
  return [...scope, `v.${comparison.column} ${operator} ${bind(comparison.bound)}${comparison.cast}`].join(" AND ")
}

/** Compiles a filter set into SQL predicates correlated to a document id already in scope.
 *
 * Shared by the completeness query below and by the retrieval pre-filters in Stage 2, which is why
 * it takes the correlated expression (`d."id"` there, `"document_chunks"."document_id"` here) and a
 * `bind` closure rather than owning its own parameter list. Filters AND together; `neq` inverts to
 * NOT EXISTS, giving the per-document semantics documented on FieldFilter.
 *
 * Returns [] when nothing is expressible, which callers must read as "no constraint". */
export function compileFieldFilters(filters: FieldFilter[], documentRef: string, workspaceRef: string, bind: (value: unknown) => string): string[] {
  const predicates: string[] = []
  for (const filter of filters) {
    const condition = filterCondition(filter, bind)
    if (!condition) continue
    const exists = `SELECT 1 FROM "document_field_values" v WHERE v."document_id" = ${documentRef} AND v."workspace_id" = ${workspaceRef} AND ${condition}`
    predicates.push(filter.op === "neq" ? `NOT EXISTS (${exists})` : `EXISTS (${exists})`)
  }
  return predicates
}

// ---- Pure SQL builders (tested directly) -------------------------------------------------------

export function buildDeleteFieldValuesSql(workspaceId: string, documentId: string): Sql {
  return {
    text: `DELETE FROM "document_field_values" WHERE "document_id" = $1::uuid AND "workspace_id" = $2::uuid`,
    params: [documentId, workspaceId],
  }
}

/** One projected row plus the ids that locate it. */
export type FieldValueInsert = FieldValueRow & { workspaceId: string; documentId: string; fileId: string; templateCode: string | null }

export function buildInsertFieldValuesSql(rows: FieldValueInsert[]): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const tuples = rows.map((row) =>
    `(${bind(row.workspaceId)}::uuid, ${bind(row.documentId)}::uuid, ${bind(row.fileId)}::uuid, ${bind(row.templateCode)}, ${bind(row.fieldKey)}, ${bind(row.itemKey)}, ${bind(row.rowIndex)}, ${bind(row.valueText)}, ${bind(row.valueNumber)}, ${bind(row.valueDate)}::date, ${bind(row.valueBool)}, ${bind(row.source)}, ${bind(row.sourceConfidence)}, ${bind(row.provenance ? JSON.stringify(row.provenance) : null)}::jsonb)`
  )
  return {
    text: `INSERT INTO "document_field_values" ("workspace_id", "document_id", "file_id", "template_code", "field_key", "item_key", "row_index", "value_text", "value_number", "value_date", "value_bool", "source", "source_confidence", "provenance") VALUES ${tuples.join(", ")}`,
    params,
  }
}

/** The completeness query: every document in the workspace whose extracted values satisfy every
 * filter. Deliberately NOT top-k — this is the channel that answers "all invoices from vendor X",
 * which a vector search cannot promise however many neighbours it returns. */
export function buildFindDocumentsByFieldsSql(workspaceId: string, filters: FieldFilter[], options: { templateCode?: string | null; limit?: number } = {}): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  const where = [`d."workspace_id" = ${workspaceRef}`]
  if (options.templateCode) where.push(`EXISTS (SELECT 1 FROM "document_templates" t WHERE t."id" = d."template_id" AND t."code" = ${bind(options.templateCode)})`)
  where.push(...compileFieldFilters(filters, `d."id"`, workspaceRef, bind))
  return {
    text: `SELECT d."id" AS "documentId", d."file_id" AS "fileId", d."filename", d."status", d."received_at" AS "receivedAt", d."reviewed_data" AS "reviewedData"
       FROM "documents" d
       WHERE ${where.join(" AND ")}
       ORDER BY d."received_at" DESC
       LIMIT ${bind(Math.min(options.limit ?? MAX_MATCH_ROWS, MAX_MATCH_ROWS) + 1)}`,
    params,
  }
}

// ---- Execution ---------------------------------------------------------------------------------

/** Replaces one document's projected values atomically: drop the old set, insert the new one in
 * batches. Idempotent — re-running with the same values produces the same rows.
 *
 * Takes an optional transaction client so the extraction path can write the projection inside the
 * SAME transaction that writes reviewedData, which is what keeps the two from ever disagreeing. */
export async function replaceDocumentFieldValues(
  input: { workspaceId: string; documentId: string; fileId: string; templateCode: string | null; rows: FieldValueRow[] },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const { workspaceId, documentId, fileId, templateCode, rows } = input
  const inserts: FieldValueInsert[] = rows.map((row) => ({ ...row, workspaceId, documentId, fileId, templateCode }))
  const run = async (client: Prisma.TransactionClient) => {
    const del = buildDeleteFieldValuesSql(workspaceId, documentId)
    await client.$executeRawUnsafe(del.text, ...del.params)
    for (let start = 0; start < inserts.length; start += INSERT_BATCH) {
      const ins = buildInsertFieldValuesSql(inserts.slice(start, start + INSERT_BATCH))
      await client.$executeRawUnsafe(ins.text, ...ins.params)
    }
  }
  if (tx) return run(tx)
  await prisma.$transaction(run)
}

/** A document matched by a structured filter, with the values it was matched on available for
 * rendering without a second read. */
export type FieldMatchRow = {
  documentId: string
  fileId: string
  filename: string
  status: string
  receivedAt: Date
  reviewedData: Record<string, unknown> | null
}

/** Runs the completeness query. `truncated` is true only if the safety cap was actually reached,
 * so a caller can say "showing the first N" instead of quietly reporting a partial answer as whole. */
export async function findDocumentsByFields(
  workspaceId: string,
  filters: FieldFilter[],
  options: { templateCode?: string | null; limit?: number } = {},
): Promise<{ rows: FieldMatchRow[]; truncated: boolean }> {
  const cap = Math.min(options.limit ?? MAX_MATCH_ROWS, MAX_MATCH_ROWS)
  const built = buildFindDocumentsByFieldsSql(workspaceId, filters, options)
  const rows = await prisma.$queryRawUnsafe<FieldMatchRow[]>(built.text, ...built.params)
  return { rows: rows.slice(0, cap), truncated: rows.length > cap }
}

/** One filterable field in a workspace, with the value types actually present under it. */
export type WorkspaceFieldKey = {
  fieldKey: string
  itemKey: string | null
  hasText: boolean
  hasNumber: boolean
  hasDate: boolean
  hasBool: boolean
  /** How many values exist under this key — used only to order the catalogue, most-populated first. */
  valueCount: number
}

/** The filterable vocabulary of one workspace, read from the projection itself rather than from the
 * template definitions.
 *
 * Deliberate: a key only appears here if values are actually stored under it, so the query router
 * can only ever emit a filter that could match something. A template field nobody's documents
 * populate would otherwise invite the model to filter on it and silently return nothing. */
export async function listWorkspaceFieldKeys(workspaceId: string): Promise<WorkspaceFieldKey[]> {
  return prisma.$queryRawUnsafe<WorkspaceFieldKey[]>(
    `SELECT "field_key" AS "fieldKey", "item_key" AS "itemKey",
        bool_or("value_text" IS NOT NULL) AS "hasText",
        bool_or("value_number" IS NOT NULL) AS "hasNumber",
        bool_or("value_date" IS NOT NULL) AS "hasDate",
        bool_or("value_bool" IS NOT NULL) AS "hasBool",
        count(*)::int AS "valueCount"
      FROM "document_field_values"
      WHERE "workspace_id" = $1::uuid
      GROUP BY "field_key", "item_key"
      ORDER BY count(*) DESC`,
    workspaceId,
  )
}

/** Everything projected for one document, for the "where did this come from" panel and for tests
 * that cross-check the projection against reviewedData. */
export async function getDocumentFieldValues(workspaceId: string, documentId: string) {
  return prisma.documentFieldValue.findMany({
    where: { workspaceId, documentId },
    orderBy: [{ fieldKey: "asc" }, { rowIndex: "asc" }, { itemKey: "asc" }],
  })
}
