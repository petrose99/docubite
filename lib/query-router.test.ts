import type { WorkspaceFieldKey } from "@/models/document-field-values"
import { beforeEach, describe, expect, it, vi } from "vitest"

const routerConfig = { routerEnabled: true, rerankEnabled: false, rerankBaseUrl: "", rerankApiKey: "", rerankModelName: "m", rerankTimeoutMs: 10 }
const aiConfig = { provider: "gemini" as const, geminiApiKey: "key", geminiModelName: "model", openaiApiKey: "", openaiModelName: "" }

vi.mock("@/lib/config", () => ({ default: { get retrieval() { return routerConfig }, get ai() { return aiConfig } } }))

const requestLLM = vi.fn()
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: (...args: unknown[]) => requestLLM(...args) }))

const listWorkspaceFieldKeys = vi.fn()
vi.mock("@/models/document-field-values", () => ({ listWorkspaceFieldKeys: (...args: unknown[]) => listWorkspaceFieldKeys(...args) }))

const { coerceRoutedFilter, parseRouterOutput, routeQuery } = await import("@/lib/query-router")

const WS = "11111111-1111-1111-1111-111111111111"

const key = (over: Partial<WorkspaceFieldKey>): WorkspaceFieldKey => ({
  fieldKey: "vendor", itemKey: null, hasText: true, hasNumber: false, hasDate: false, hasBool: false, valueCount: 1, ...over,
})

const KEYS: WorkspaceFieldKey[] = [
  key({ fieldKey: "vendor" }),
  key({ fieldKey: "total", hasText: false, hasNumber: true }),
  key({ fieldKey: "issue_date", hasText: true, hasDate: true }),
  key({ fieldKey: "paid", hasText: false, hasBool: true }),
  key({ fieldKey: "line_items", itemKey: "sku" }),
]

beforeEach(() => {
  requestLLM.mockReset()
  listWorkspaceFieldKeys.mockReset().mockResolvedValue(KEYS)
  routerConfig.routerEnabled = true
})

describe("coerceRoutedFilter", () => {
  it("accepts a filter on a known field and coerces the value to that field's type", () => {
    expect(coerceRoutedFilter({ field: "total", op: "gte", value: "1000" }, KEYS)).toEqual({ fieldKey: "total", itemKey: null, op: "gte", value: 1000 })
    expect(coerceRoutedFilter({ field: "issue_date", op: "lte", value: "2026-03-31" }, KEYS)).toEqual({ fieldKey: "issue_date", itemKey: null, op: "lte", value: "2026-03-31" })
    expect(coerceRoutedFilter({ field: "paid", op: "eq", value: "true" }, KEYS)).toEqual({ fieldKey: "paid", itemKey: null, op: "eq", value: true })
  })

  it("strips currency symbols and separators from a numeric value", () => {
    expect(coerceRoutedFilter({ field: "total", op: "gt", value: "£1,250.50" }, KEYS)).toEqual({ fieldKey: "total", itemKey: null, op: "gt", value: 1250.5 })
  })

  it("resolves dot notation to an array row field", () => {
    expect(coerceRoutedFilter({ field: "line_items.sku", op: "eq", value: "SKU-1" }, KEYS)).toEqual({ fieldKey: "line_items", itemKey: "sku", op: "eq", value: "SKU-1" })
  })

  it("drops a field the workspace does not have — the model cannot invent one", () => {
    expect(coerceRoutedFilter({ field: "patient_id", op: "eq", value: "X" }, KEYS)).toBeNull()
    expect(coerceRoutedFilter({ field: "line_items.colour", op: "eq", value: "red" }, KEYS)).toBeNull()
  })

  it("drops an operator outside the allowed set", () => {
    expect(coerceRoutedFilter({ field: "vendor", op: "regex", value: "^a" }, KEYS)).toBeNull()
    expect(coerceRoutedFilter({ field: "vendor", op: "DROP", value: "x" }, KEYS)).toBeNull()
  })

  it("drops a range operator on a text-only field rather than comparing alphabetically", () => {
    expect(coerceRoutedFilter({ field: "vendor", op: "gt", value: "Acme" }, KEYS)).toBeNull()
  })

  it("drops a missing or empty value, except for exists", () => {
    expect(coerceRoutedFilter({ field: "vendor", op: "eq" }, KEYS)).toBeNull()
    expect(coerceRoutedFilter({ field: "vendor", op: "eq", value: "  " }, KEYS)).toBeNull()
    expect(coerceRoutedFilter({ field: "vendor", op: "exists" }, KEYS)).toEqual({ fieldKey: "vendor", itemKey: null, op: "exists" })
  })

  it("drops garbage rather than throwing", () => {
    for (const raw of [null, undefined, "vendor", 42, [], {}]) expect(coerceRoutedFilter(raw, KEYS)).toBeNull()
  })
})

describe("parseRouterOutput", () => {
  it("keeps valid filters and drops invalid ones from the same response", () => {
    const routed = parseRouterOutput(
      { filters: [{ field: "vendor", op: "eq", value: "Acme" }, { field: "nonexistent", op: "eq", value: "x" }], semantic_query: "invoice" },
      "invoices from Acme", KEYS,
    )
    expect(routed.filters).toEqual([{ fieldKey: "vendor", itemKey: null, op: "eq", value: "Acme" }])
    expect(routed.semanticQuery).toBe("invoice")
    expect(routed.via).toBe("llm")
  })

  it("falls back to the original query when the model returns no semantic remainder", () => {
    const routed = parseRouterOutput({ filters: [], semantic_query: "  " }, "what did we buy", KEYS)
    expect(routed.semanticQuery).toBe("what did we buy")
    expect(routed.via).toBe("no_filters")
  })

  it("degrades to no filters on a malformed response rather than throwing", () => {
    for (const output of [{}, { filters: "not an array" }, { filters: [1, 2, 3] }]) {
      const routed = parseRouterOutput(output as Record<string, unknown>, "raw query", KEYS)
      expect(routed.filters).toEqual([])
      expect(routed.semanticQuery).toBe("raw query")
    }
  })
})

describe("routeQuery fail-safes", () => {
  it("passes through untouched when the router is disabled, without calling the model", async () => {
    routerConfig.routerEnabled = false
    const routed = await routeQuery(WS, "invoices from Acme over 1000")
    expect(routed).toEqual({ filters: [], semanticQuery: "invoices from Acme over 1000", via: "disabled" })
    expect(requestLLM).not.toHaveBeenCalled()
  })

  it("short-circuits a bare identifier — the lexical channel already matches it verbatim", async () => {
    const routed = await routeQuery(WS, "INV-2026-0042")
    expect(routed.via).toBe("bare_identifier")
    expect(requestLLM).not.toHaveBeenCalled()
  })

  it("routes a bare identifier anyway when forced, since find_documents has no unrouted fallback", async () => {
    requestLLM.mockResolvedValue({ output: { filters: [{ field: "vendor", op: "eq", value: "Acme" }], semantic_query: "invoice" } })
    const routed = await routeQuery(WS, "INV-2026-0042", { force: true })
    expect(requestLLM).toHaveBeenCalled()
    expect(routed.via).toBe("llm")
  })

  it("skips the model when the workspace has no projected values to filter on", async () => {
    listWorkspaceFieldKeys.mockResolvedValue([])
    const routed = await routeQuery(WS, "invoices from Acme")
    expect(routed).toEqual({ filters: [], semanticQuery: "invoices from Acme", via: "no_field_vocabulary" })
    expect(requestLLM).not.toHaveBeenCalled()
  })

  it("passes through when the model errors", async () => {
    requestLLM.mockResolvedValue({ output: {}, error: "ai_extraction_failed" })
    const routed = await routeQuery(WS, "invoices from Acme")
    expect(routed).toEqual({ filters: [], semanticQuery: "invoices from Acme", via: "llm_failed" })
  })

  it("passes through when anything throws, rather than failing the search", async () => {
    listWorkspaceFieldKeys.mockRejectedValue(new Error("db is down"))
    const routed = await routeQuery(WS, "invoices from Acme")
    expect(routed).toEqual({ filters: [], semanticQuery: "invoices from Acme", via: "llm_failed" })
  })

  it("tells the model today's date so relative periods resolve", async () => {
    requestLLM.mockResolvedValue({ output: { filters: [], semantic_query: "x" } })
    await routeQuery(WS, "invoices last March", { now: new Date("2026-08-19T00:00:00Z") })
    expect(String(requestLLM.mock.calls[0][1].prompt)).toContain("Today is 2026-08-19")
  })

  it("offers the model only the fields the workspace actually has", async () => {
    requestLLM.mockResolvedValue({ output: { filters: [], semantic_query: "x" } })
    await routeQuery(WS, "anything")
    const prompt = String(requestLLM.mock.calls[0][1].prompt)
    expect(prompt).toContain("- vendor (text)")
    expect(prompt).toContain("- total (number)")
    expect(prompt).toContain("- line_items.sku (text) [a field inside a repeated row]")
    expect(prompt).not.toContain("patient_id")
  })
})
