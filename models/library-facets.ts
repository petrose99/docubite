import { prisma } from "@/lib/db"
import { stageWhereClause } from "@/models/documents"
import type { Sql } from "@/models/document-field-values"

export type TemplateFacet = { id: string; name: string; count: number }
export type ValueFacet = { value: string; count: number }

export type LibraryFacets = {
  templates: TemplateFacet[]
  categories: ValueFacet[]
  suppliers: ValueFacet[]
}

export function buildCategoryFacetSql(workspaceId: string): Sql {
  return {
    text: `SELECT COALESCE(d.coding_data->>'account', d.reviewed_data->>'category') AS "value",
        count(*)::int AS "count"
      FROM "documents" d
      WHERE d."workspace_id" = $1::uuid
        AND d."status" = 'reviewed'
        AND d."archived_at" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "review_tasks" rt WHERE rt."document_id" = d."id" AND rt."status" IN ('open','in_review'))
        AND COALESCE(d.coding_data->>'account', d.reviewed_data->>'category') IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 30`,
    params: [workspaceId],
  }
}

export function buildSupplierFacetSql(workspaceId: string): Sql {
  return {
    text: `SELECT dfv."value_text" AS "value",
        count(DISTINCT dfv."document_id")::int AS "count"
      FROM "document_field_values" dfv
        INNER JOIN "documents" d ON d."id" = dfv."document_id"
      WHERE dfv."workspace_id" = $1::uuid
        AND dfv."field_key" = 'supplier_name'
        AND dfv."item_key" IS NULL
        AND dfv."value_text" IS NOT NULL
        AND d."status" = 'reviewed'
        AND d."archived_at" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "review_tasks" rt WHERE rt."document_id" = d."id" AND rt."status" IN ('open','in_review'))
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 30`,
    params: [workspaceId],
  }
}

export async function listLibraryFacets(workspaceId: string): Promise<LibraryFacets> {
  const readyWhere = { workspaceId, ...stageWhereClause("ready") }

  const [templateRows, categoryRows, supplierRows] = await Promise.all([
    prisma.document.groupBy({
      by: ["templateId"],
      where: readyWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    ((): Promise<{ value: string; count: number }[]> => {
      const sql = buildCategoryFacetSql(workspaceId)
      return prisma.$queryRawUnsafe(sql.text, ...sql.params)
    })(),
    ((): Promise<{ value: string; count: number }[]> => {
      const sql = buildSupplierFacetSql(workspaceId)
      return prisma.$queryRawUnsafe(sql.text, ...sql.params)
    })(),
  ])

  const templateIds = templateRows.filter((r) => r.templateId).map((r) => r.templateId!)
  const templateLookup = templateIds.length
    ? new Map((await prisma.documentTemplate.findMany({ where: { workspaceId, id: { in: templateIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]))
    : new Map<string, string>()

  const templates: TemplateFacet[] = templateRows
    .filter((r) => r.templateId && templateLookup.has(r.templateId))
    .map((r) => ({ id: r.templateId!, name: templateLookup.get(r.templateId!)!, count: r._count.id }))

  return { templates, categories: categoryRows, suppliers: supplierRows }
}
