import { describe, expect, it } from "vitest"
import { buildCategoryFacetSql, buildSupplierFacetSql } from "./library-facets"

describe("buildCategoryFacetSql", () => {
  it("binds workspace_id and scopes to ready-stage documents", () => {
    const wsId = "ws-123"
    const { text, params } = buildCategoryFacetSql(wsId)
    expect(params).toEqual([wsId])
    expect(text).toContain("$1::uuid")
    expect(text).toContain(`"status" = 'reviewed'`)
    expect(text).toContain(`"archived_at" IS NULL`)
    expect(text).toContain("COALESCE")
    expect(text).toContain("GROUP BY 1")
    expect(text).toContain("LIMIT 30")
  })

  it("excludes documents with open review tasks", () => {
    const { text } = buildCategoryFacetSql("ws-1")
    expect(text).toContain("NOT EXISTS")
    expect(text).toContain("review_tasks")
  })
})

describe("buildSupplierFacetSql", () => {
  it("binds workspace_id and joins documents for ready-stage filter", () => {
    const wsId = "ws-456"
    const { text, params } = buildSupplierFacetSql(wsId)
    expect(params).toEqual([wsId])
    expect(text).toContain("$1::uuid")
    expect(text).toContain(`"field_key" = 'supplier_name'`)
    expect(text).toContain(`"item_key" IS NULL`)
    expect(text).toContain("DISTINCT")
    expect(text).toContain("GROUP BY 1")
    expect(text).toContain("LIMIT 30")
  })

  it("joins documents table for stage filtering", () => {
    const { text } = buildSupplierFacetSql("ws-1")
    expect(text).toContain("INNER JOIN")
    expect(text).toContain(`"documents" d`)
    expect(text).toContain(`"status" = 'reviewed'`)
  })
})
