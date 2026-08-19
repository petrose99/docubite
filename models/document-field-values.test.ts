import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const { buildDeleteFieldValuesSql, buildFindDocumentsByFieldsSql, buildInsertFieldValuesSql, compileFieldFilters } = await import("@/models/document-field-values")

const WS = "11111111-1111-1111-1111-111111111111"
const DOC = "22222222-2222-2222-2222-222222222222"
const FILE = "33333333-3333-3333-3333-333333333333"

const row = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS, documentId: DOC, fileId: FILE, templateCode: "invoice",
  fieldKey: "vendor", itemKey: null, rowIndex: null,
  valueText: "Acme", valueNumber: null, valueDate: null, valueBool: null,
  source: "llm_structured" as const, sourceConfidence: 0.9, provenance: null,
  ...over,
})

/** Collects the bind placeholders a filter compiles to, with a fresh counter each time. */
function compile(filters: Parameters<typeof compileFieldFilters>[0]) {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const predicates = compileFieldFilters(filters, `d."id"`, `$0::uuid`, bind)
  return { predicates, params }
}

describe("buildDeleteFieldValuesSql", () => {
  it("scopes by both document_id and workspace_id", () => {
    const sql = buildDeleteFieldValuesSql(WS, DOC)
    expect(sql.text).toContain(`"document_id" = $1::uuid`)
    expect(sql.text).toContain(`"workspace_id" = $2::uuid`)
    expect(sql.params).toEqual([DOC, WS])
  })
})

describe("buildInsertFieldValuesSql", () => {
  it("binds every value (14 per row) and never interpolates the workspace id", () => {
    const sql = buildInsertFieldValuesSql([row(), row({ fieldKey: "total", valueText: null, valueNumber: 42 })])
    expect(sql.params).toHaveLength(28)
    expect(sql.params.filter((param) => param === WS)).toHaveLength(2)
    expect(sql.text).not.toContain(WS)
    expect(sql.text).toContain("::date")
    expect(sql.text).toContain("::jsonb")
  })

  it("stringifies provenance and leaves an absent one null", () => {
    const sql = buildInsertFieldValuesSql([row({ provenance: { page: 2, bbox: null, quote: "q", blockIndex: 1, score: 0.8 } }), row()])
    expect(sql.params).toContain(`{"page":2,"bbox":null,"quote":"q","blockIndex":1,"score":0.8}`)
    expect(sql.params.filter((param) => param === null).length).toBeGreaterThan(0)
  })

  it("produces one VALUES tuple per row", () => {
    const sql = buildInsertFieldValuesSql([row(), row(), row()])
    expect(sql.text.match(/::jsonb\)/g)).toHaveLength(3)
  })
})

describe("compileFieldFilters", () => {
  it("routes a value to the typed column matching its runtime type", () => {
    expect(compile([{ fieldKey: "total", op: "eq", value: 42 }]).predicates[0]).toContain(`v."value_number" = $2::double precision`)
    expect(compile([{ fieldKey: "issue_date", op: "gte", value: "2026-01-01" }]).predicates[0]).toContain(`v."value_date" >= $2::date`)
    expect(compile([{ fieldKey: "paid", op: "eq", value: true }]).predicates[0]).toContain(`v."value_bool" = $2`)
    expect(compile([{ fieldKey: "vendor", op: "eq", value: "Acme" }]).predicates[0]).toContain(`v."value_text_norm" = $2`)
  })

  it("normalises a text comparison the same way the generated column does", () => {
    expect(compile([{ fieldKey: "vendor", op: "eq", value: "  ACME Ltd " }]).params).toContain("acme ltd")
  })

  it("matches scalars only unless an item_key is given", () => {
    expect(compile([{ fieldKey: "vendor", op: "exists" }]).predicates[0]).toContain(`v."item_key" IS NULL`)
    const withItem = compile([{ fieldKey: "line_items", itemKey: "sku", op: "eq", value: "SKU-1" }])
    expect(withItem.predicates[0]).toContain(`v."item_key" = $2`)
    expect(withItem.params).toContain("sku")
  })

  it("inverts neq to NOT EXISTS, so an array row cannot satisfy it by accident", () => {
    const { predicates } = compile([{ fieldKey: "vendor", op: "neq", value: "Acme" }])
    expect(predicates[0].startsWith("NOT EXISTS (")).toBe(true)
  })

  it("escapes LIKE wildcards so a literal % stays literal", () => {
    const { params } = compile([{ fieldKey: "vendor", op: "contains", value: "50%_off" }])
    expect(params).toContain("%50\\%\\_off%")
  })

  it("drops a filter it cannot express rather than matching everything", () => {
    // A range over text would compare alphabetically, and an unknown operator has no meaning.
    expect(compile([{ fieldKey: "vendor", op: "gt", value: "Acme" }]).predicates).toEqual([])
    expect(compile([{ fieldKey: "vendor", op: "eq", value: null }]).predicates).toEqual([])
    expect(compile([{ fieldKey: "vendor", op: "contains", value: "   " }]).predicates).toEqual([])
  })

  it("binds the field key rather than interpolating it", () => {
    const { predicates, params } = compile([{ fieldKey: "vendor'; DROP TABLE documents; --", op: "exists" }])
    expect(predicates[0]).not.toContain("DROP TABLE")
    expect(params).toContain("vendor'; DROP TABLE documents; --")
  })

  it("scopes every EXISTS to the workspace as well as the document", () => {
    const { predicates } = compile([{ fieldKey: "vendor", op: "eq", value: "Acme" }])
    expect(predicates[0]).toContain(`v."document_id" = d."id"`)
    expect(predicates[0]).toContain(`v."workspace_id" = $0::uuid`)
  })
})

describe("buildFindDocumentsByFieldsSql", () => {
  it("ANDs the filters and never truncates to a top-k", () => {
    const sql = buildFindDocumentsByFieldsSql(WS, [
      { fieldKey: "vendor", op: "eq", value: "Acme" },
      { fieldKey: "total", op: "gte", value: 100 },
    ])
    expect(sql.text.match(/EXISTS \(/g)).toHaveLength(2)
    expect(sql.text).toContain(" AND EXISTS (")
    // The only LIMIT is the safety cap, bound as a param — not a relevance cut-off.
    expect(sql.params[sql.params.length - 1]).toBe(5001)
  })

  it("scopes to the workspace with a single reused bind", () => {
    const sql = buildFindDocumentsByFieldsSql(WS, [{ fieldKey: "vendor", op: "exists" }])
    expect(sql.params.filter((param) => param === WS)).toHaveLength(1)
    expect(sql.text).toContain(`d."workspace_id" = $1::uuid`)
    expect(sql.text).not.toContain(WS)
  })

  it("returns every document in the workspace when no filter is expressible", () => {
    const sql = buildFindDocumentsByFieldsSql(WS, [])
    expect(sql.text).not.toContain("EXISTS")
    expect(sql.text).toContain(`d."workspace_id" = $1::uuid`)
  })

  it("narrows to one worksheet code when asked", () => {
    const sql = buildFindDocumentsByFieldsSql(WS, [], { templateCode: "pathology_report" })
    expect(sql.text).toContain(`t."code" = $2`)
    expect(sql.params).toContain("pathology_report")
  })

  it("caps an over-large caller limit at MAX_MATCH_ROWS", () => {
    const sql = buildFindDocumentsByFieldsSql(WS, [], { limit: 100_000 })
    expect(sql.params[sql.params.length - 1]).toBe(5001)
  })
})
