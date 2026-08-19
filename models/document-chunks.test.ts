import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/embeddings", () => ({ toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]` }))

const { buildDeleteChunksSql, buildHashesSql, buildInsertChunksSql, buildVectorSearchSql, buildLexicalSearchSql } = await import("@/models/document-chunks")

const WS = "11111111-1111-1111-1111-111111111111"
const DOC = "22222222-2222-2222-2222-222222222222"

describe("buildDeleteChunksSql", () => {
  it("scopes by both document_id and workspace_id, in that param order", () => {
    const sql = buildDeleteChunksSql(WS, DOC)
    expect(sql.text).toContain(`"document_id" = $1::uuid`)
    expect(sql.text).toContain(`"workspace_id" = $2::uuid`)
    expect(sql.params).toEqual([DOC, WS])
  })
})

describe("buildHashesSql", () => {
  it("selects content_hash scoped to the workspace, ordered by chunk_index", () => {
    const sql = buildHashesSql(WS, DOC)
    expect(sql.text).toContain(`"content_hash" AS "contentHash"`)
    expect(sql.text).toContain(`ORDER BY "chunk_index"`)
    expect(sql.params).toContain(WS)
  })
})

describe("buildInsertChunksSql", () => {
  const rows = [
    { workspaceId: WS, documentId: DOC, fileId: "f1", chunkIndex: 0, text: "a", provenance: null, contentHash: "h0", embedding: "[1,2,3]", source: "vlm_ocr" },
    { workspaceId: WS, documentId: DOC, fileId: "f1", chunkIndex: 1, text: "b", provenance: '{"pages":[1]}', contentHash: "h1", embedding: "[4,5,6]", source: "asr" },
  ]

  it("binds every value (9 per row) with the right casts", () => {
    const sql = buildInsertChunksSql(rows)
    expect(sql.params).toHaveLength(rows.length * 9)
    expect(sql.text).toContain("::vector")
    expect(sql.text).toContain("::jsonb")
    expect(sql.text).toContain("::uuid")
  })

  it("binds workspace_id once per row (never interpolated)", () => {
    const sql = buildInsertChunksSql(rows)
    expect(sql.params.filter((param) => param === WS)).toHaveLength(rows.length)
    // The workspace id must never appear inline in the SQL text.
    expect(sql.text).not.toContain(WS)
  })

  it("produces one VALUES tuple per row", () => {
    const sql = buildInsertChunksSql(rows)
    expect(sql.text.match(/::vector, \$\d+\)/g)).toHaveLength(rows.length)
  })

  it("records how each chunk's text was obtained", () => {
    const sql = buildInsertChunksSql(rows)
    expect(sql.text).toContain(`"source"`)
    expect(sql.params).toContain("vlm_ocr")
    expect(sql.params).toContain("asr")
  })
})

describe("search builders", () => {
  it("vector search orders by cosine distance, scoped to the workspace, selecting file_id", () => {
    const sql = buildVectorSearchSql(WS, "[1,2,3]", 24)
    expect(sql.text).toContain("<=>")
    expect(sql.text).toContain(`"embedding" IS NOT NULL`)
    expect(sql.text).toContain(`"workspace_id" = $2::uuid`)
    expect(sql.text).toContain(`"file_id" AS "fileId"`)
    expect(sql.params).toEqual(["[1,2,3]", WS, 24])
  })

  it("lexical search uses the 'simple' config and websearch_to_tsquery, selecting file_id", () => {
    const sql = buildLexicalSearchSql(WS, "invoice 42", 24)
    expect(sql.text).toContain(`websearch_to_tsquery('simple', $1)`)
    expect(sql.text).toContain(`"workspace_id" = $2::uuid`)
    expect(sql.text).toContain(`"file_id" AS "fileId"`)
    expect(sql.params).toEqual(["invoice 42", WS, 24])
  })
})

describe("structured pre-filters", () => {
  const filters = [{ fieldKey: "vendor", op: "eq" as const, value: "Acme" }]

  it("changes neither query when no filters are given", () => {
    expect(buildVectorSearchSql(WS, "[1,2,3]", 24, [])).toEqual(buildVectorSearchSql(WS, "[1,2,3]", 24))
    expect(buildLexicalSearchSql(WS, "q", 24, [])).toEqual(buildLexicalSearchSql(WS, "q", 24))
  })

  it("filters INSIDE the WHERE clause, so the index scan is narrowed rather than post-filtered", () => {
    const sql = buildVectorSearchSql(WS, "[1,2,3]", 24, filters)
    const where = sql.text.slice(sql.text.indexOf("WHERE"), sql.text.indexOf("ORDER BY"))
    expect(where).toContain("EXISTS (")
    expect(where).toContain(`"document_chunks"."document_id"`)
    // The ORDER BY / LIMIT that do the ranking still come after it, untouched.
    expect(sql.text).toContain(`ORDER BY "embedding" <=> $1::vector`)
    expect(sql.text).toContain("LIMIT $3")
  })

  it("keeps the original three binds in place and appends filter binds after them", () => {
    const sql = buildLexicalSearchSql(WS, "q", 24, filters)
    expect(sql.params.slice(0, 3)).toEqual(["q", WS, 24])
    expect(sql.params.slice(3)).toEqual(["vendor", "acme"])
    expect(sql.text).toContain("LIMIT $3")
  })

  it("scopes the filter subquery to the same workspace bind, never a new one", () => {
    const sql = buildVectorSearchSql(WS, "[1,2,3]", 24, filters)
    expect(sql.params.filter((param) => param === WS)).toHaveLength(1)
    expect(sql.text).toContain(`v."workspace_id" = $2::uuid`)
    expect(sql.text).not.toContain(WS)
  })

  it("ANDs multiple filters into both channels", () => {
    const two = [...filters, { fieldKey: "total", op: "gte" as const, value: 100 }]
    for (const sql of [buildVectorSearchSql(WS, "[1]", 24, two), buildLexicalSearchSql(WS, "q", 24, two)]) {
      expect(sql.text.match(/EXISTS \(/g)).toHaveLength(2)
    }
  })
})
