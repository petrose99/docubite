// Deliberately NOT a "use server" module: like models/documents.ts these are internal data-access
// helpers that trust their caller-supplied workspaceId. Server actions in
// app/(app)/workspaces/[workspaceId]/data-actions.ts do the auth.
import { flattenDocumentValues } from "@/lib/document-values"
import { parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
// Type-only: nothing from the generated client is needed at runtime (the one raw query uses the
// prisma instance's own tagged-template $queryRaw), so this import is erased on compile.
import type { Prisma } from "@/prisma/client"

/** The slice of a Document the sync needs: its id, workspace, and the field snapshot it was
 * extracted against (so values flatten the way the document was actually shaped). */
type SyncableDocument = { id: string; workspaceId: string; fieldSnapshot: unknown }

/** Builds the Prisma ops that replace a document's flattened field values with the ones derived
 * from `reviewedData`, to be spread into the SAME `$transaction([...])` as the reviewedData write.
 *
 * Always a delete-all followed by (when there are rows) a createMany — a plain replace, matching
 * the no-unique-constraint schema. parseTemplateFields can throw on a legacy or malformed snapshot;
 * that degrades to a deleteMany only, so index bookkeeping never fails an extraction or an edit. */
export function documentFieldValueSyncOps(document: SyncableDocument, reviewedData: unknown): Prisma.PrismaPromise<unknown>[] {
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.documentFieldValue.deleteMany({ where: { documentId: document.id } }),
  ]
  const data = reviewedData && typeof reviewedData === "object" && !Array.isArray(reviewedData) ? (reviewedData as Record<string, unknown>) : {}
  let rows: ReturnType<typeof flattenDocumentValues>
  try {
    rows = flattenDocumentValues(parseTemplateFields(document.fieldSnapshot), data)
  } catch {
    return ops
  }
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
        // The column is @db.Date; hand Prisma a real Date rather than a bare "YYYY-MM-DD".
        valueDate: row.valueDate ? new Date(`${row.valueDate}T00:00:00.000Z`) : null,
        valueBool: row.valueBool,
      })),
    }))
  }
  return ops
}

/* --------------------------------------------------------------------------- data browser --- */

/** Filters for the /data document list. Every field is optional; an absent field is no filter. */
export type DataFilters = {
  /** Free text: matched against searchText/ocrText AND any flattened field value's text. */
  query?: string
  /** A DocumentTemplate (worksheet) id — documents extracted with that worksheet. */
  templateId?: string
  fileId?: string
  /** A classification.docType label. */
  docType?: string
  status?: string
  /** receivedAt lower/upper bounds as "YYYY-MM-DD". */
  from?: string
  to?: string
}

const DATA_PAGE_SIZE = 100
/** Ceiling for the in-JS grouped aggregation fetch — pglite-safe, keeps grouped sums honest at
 * capped scale without a raw GROUP BY. */
const AGGREGATE_ROW_CAP = 5000

const parseBoundaryDate = (value: string | undefined, endOfDay: boolean): Date | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** The shared Document `where` behind both the list and the aggregates, so a filtered aggregate
 * covers exactly the documents the list shows. */
function documentWhere(workspaceId: string, filters: DataFilters): Prisma.DocumentWhereInput {
  const query = filters.query?.trim()
  const receivedAt: Prisma.DateTimeFilter = {}
  const from = parseBoundaryDate(filters.from, false)
  const to = parseBoundaryDate(filters.to, true)
  if (from) receivedAt.gte = from
  if (to) receivedAt.lte = to
  return {
    workspaceId,
    ...(filters.fileId ? { fileId: filters.fileId } : {}),
    ...(filters.templateId ? { templateId: filters.templateId } : {}),
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.docType ? { classification: { path: ["docType"], equals: filters.docType } } : {}),
    ...(from || to ? { receivedAt } : {}),
    ...(query
      ? {
          OR: [
            { searchText: { contains: query, mode: "insensitive" as const } },
            { ocrText: { contains: query, mode: "insensitive" as const } },
            { fieldValues: { some: { valueText: { contains: query, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  }
}

export type DataDocumentSort = "receivedAt" | "filename" | "status"

export type DataDocument = Awaited<ReturnType<typeof listDocumentData>>[number]

/** The workspace's documents for the /data browser, newest first by default, capped and
 * workspace-scoped. Carries the raw extracted data (reviewedData ?? rawExtraction) so the browser
 * can render a selected template's fields as dynamic columns without a second query. */
export function listDocumentData(
  workspaceId: string,
  filters: DataFilters = {},
  opts: { take?: number; sort?: DataDocumentSort; dir?: "asc" | "desc" } = {},
) {
  const sort = opts.sort ?? "receivedAt"
  const dir = opts.dir ?? "desc"
  return prisma.document.findMany({
    where: documentWhere(workspaceId, filters),
    select: {
      id: true,
      filename: true,
      status: true,
      receivedAt: true,
      classification: true,
      reviewedData: true,
      rawExtraction: true,
      templateId: true,
      fileId: true,
      template: { select: { name: true } },
      file: { select: { name: true } },
    },
    orderBy: { [sort]: dir },
    take: Math.min(opts.take ?? DATA_PAGE_SIZE, 1000),
  })
}

/** The dropdown options for the /data filter row: the workspace's worksheets (with their latest
 * field set, so a selection can drive dynamic columns), its files, and the distinct doc types. */
export async function listDataFilterOptions(workspaceId: string) {
  const [templates, files, docTypeRows] = await Promise.all([
    prisma.documentTemplate.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        file: { select: { name: true } },
        versions: { orderBy: { version: "desc" }, take: 1, select: { fields: true } },
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    prisma.documentFile.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.$queryRaw<{ docType: string }[]>`SELECT DISTINCT classification->>'docType' AS "docType" FROM documents WHERE workspace_id = ${workspaceId}::uuid AND classification->>'docType' IS NOT NULL AND classification->>'docType' <> '' ORDER BY 1 ASC LIMIT 100`,
  ])
  return {
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      fileName: template.file.name,
      fields: (template.versions[0]?.fields ?? []) as unknown,
    })),
    files,
    docTypes: docTypeRows.map((row) => row.docType).filter(Boolean),
  }
}

export type AggregateOp = "sum" | "avg" | "min" | "max" | "count"

export type AggregateResult = {
  op: AggregateOp
  /** Ungrouped scalar result, or null when no numeric rows matched. */
  value: number | null
  /** Present only when groupByFieldKey was given: one entry per distinct group value. */
  groups?: Array<{ group: string; value: number; count: number }>
}

/** Aggregates a numeric field across the workspace's documents. Ungrouped runs as a single Prisma
 * `aggregate`; grouped fetches the value rows and the group-field rows (each capped at
 * AGGREGATE_ROW_CAP) and joins them by documentId in JS — no raw GROUP BY, so it stays pglite-safe. */
export async function aggregateFieldValues(
  workspaceId: string,
  input: { fieldKey: string; itemKey?: string | null; op: AggregateOp; groupByFieldKey?: string | null; documentFilters?: DataFilters },
): Promise<AggregateResult> {
  const docFilter = input.documentFilters ? { document: documentWhere(workspaceId, input.documentFilters) } : {}
  const valueWhere: Prisma.DocumentFieldValueWhereInput = {
    workspaceId,
    fieldKey: input.fieldKey,
    ...(input.itemKey !== undefined && input.itemKey !== null ? { itemKey: input.itemKey } : {}),
    valueNumber: { not: null },
    ...docFilter,
  }

  if (!input.groupByFieldKey) {
    if (input.op === "count") {
      const value = await prisma.documentFieldValue.count({ where: valueWhere })
      return { op: input.op, value }
    }
    const agg = await prisma.documentFieldValue.aggregate({
      where: valueWhere,
      ...(input.op === "sum" ? { _sum: { valueNumber: true } } : {}),
      ...(input.op === "avg" ? { _avg: { valueNumber: true } } : {}),
      ...(input.op === "min" ? { _min: { valueNumber: true } } : {}),
      ...(input.op === "max" ? { _max: { valueNumber: true } } : {}),
    })
    const value = agg._sum?.valueNumber ?? agg._avg?.valueNumber ?? agg._min?.valueNumber ?? agg._max?.valueNumber ?? null
    return { op: input.op, value }
  }

  const [valueRows, groupRows] = await Promise.all([
    prisma.documentFieldValue.findMany({ where: valueWhere, select: { documentId: true, valueNumber: true }, take: AGGREGATE_ROW_CAP }),
    prisma.documentFieldValue.findMany({
      where: { workspaceId, fieldKey: input.groupByFieldKey, valueText: { not: null }, ...docFilter },
      select: { documentId: true, valueText: true },
      take: AGGREGATE_ROW_CAP,
    }),
  ])
  // Group label per document (first non-empty wins for a document-level group field).
  const groupByDoc = new Map<string, string>()
  for (const row of groupRows) {
    if (row.valueText && !groupByDoc.has(row.documentId)) groupByDoc.set(row.documentId, row.valueText)
  }
  const buckets = new Map<string, { sum: number; count: number; min: number; max: number }>()
  for (const row of valueRows) {
    if (row.valueNumber === null) continue
    const group = groupByDoc.get(row.documentId) ?? "—"
    const bucket = buckets.get(group) ?? { sum: 0, count: 0, min: row.valueNumber, max: row.valueNumber }
    bucket.sum += row.valueNumber
    bucket.count += 1
    bucket.min = Math.min(bucket.min, row.valueNumber)
    bucket.max = Math.max(bucket.max, row.valueNumber)
    buckets.set(group, bucket)
  }
  const reduce = (bucket: { sum: number; count: number; min: number; max: number }): number => {
    switch (input.op) {
      case "sum": return bucket.sum
      case "avg": return bucket.count ? bucket.sum / bucket.count : 0
      case "min": return bucket.min
      case "max": return bucket.max
      case "count": return bucket.count
    }
  }
  const groups = Array.from(buckets.entries())
    .map(([group, bucket]) => ({ group, value: reduce(bucket), count: bucket.count }))
    .sort((a, b) => b.value - a.value)
  return { op: input.op, value: null, groups }
}
