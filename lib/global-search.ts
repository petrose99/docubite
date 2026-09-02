import type { FieldFilter, FieldFilterOp } from "@/models/document-field-values"

export type ParsedSearch = {
  text: string
  filters: FieldFilter[]
  status?: string
  type?: string
}

const CHIP_PATTERN = /(?:^|\s)(vendor|supplier|amount|date|type|status)\s*([><=!:]+)\s*("[^"]*"|[^\s,]+)/gi

const OP_MAP: Record<string, FieldFilterOp> = {
  ":": "contains",
  "=": "eq",
  "==": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
}

const FIELD_ALIASES: Record<string, string> = {
  vendor: "supplier_name",
  supplier: "supplier_name",
  amount: "total_amount",
  date: "invoice_date",
}

export function parseSearchInput(q: string): ParsedSearch {
  const filters: FieldFilter[] = []
  let status: string | undefined
  let type: string | undefined

  let text = q.replace(CHIP_PATTERN, (_match, key: string, op: string, rawValue: string) => {
    const k = key.toLowerCase()
    const value = rawValue.replace(/^"|"$/g, "")

    if (k === "status") { status = value; return "" }
    if (k === "type") { type = value; return "" }

    const fieldKey = FIELD_ALIASES[k] ?? k
    const filterOp = OP_MAP[op] ?? "contains"

    if (k === "date" && value.includes("..")) {
      const [from, to] = value.split("..")
      if (from) filters.push({ fieldKey, op: "gte", value: from })
      if (to) filters.push({ fieldKey, op: "lte", value: to })
      return ""
    }

    const numValue = Number(value)
    filters.push({
      fieldKey,
      op: filterOp,
      value: Number.isFinite(numValue) && (k === "amount") ? numValue : value,
    })
    return ""
  })

  text = text.replace(/\s+/g, " ").trim()
  return { text, filters, status, type }
}

export type SearchResultItem = {
  id: string
  type: "document" | "snippet"
  documentId: string
  filename: string
  supplier?: string | null
  total?: string | null
  date?: string | null
  stage?: string
  page?: number | null
  bbox?: [number, number, number, number] | null
  snippet?: string | null
  score: number
}

export function fuseSearchResults(
  fieldMatches: { documentId: string; filename: string; values: Record<string, unknown> }[],
  chunkMatches: { documentId: string; filename: string; page: number | null; bbox: [number, number, number, number] | null; snippet: string; score: number }[],
  contentMatches: { documentId: string; filename: string; page: number | null; bbox: [number, number, number, number] | null; snippet: string }[],
): SearchResultItem[] {
  const docMap = new Map<string, SearchResultItem>()
  const snippets: SearchResultItem[] = []

  for (const [rank, m] of fieldMatches.entries()) {
    const score = 1 / (60 + rank)
    const existing = docMap.get(m.documentId)
    if (!existing) {
      docMap.set(m.documentId, {
        id: m.documentId,
        type: "document",
        documentId: m.documentId,
        filename: m.filename,
        supplier: m.values.supplier_name as string | null ?? null,
        total: m.values.total_amount != null ? String(m.values.total_amount) : null,
        date: m.values.invoice_date as string | null ?? null,
        score,
      })
    } else {
      existing.score += score
    }
  }

  for (const [rank, m] of chunkMatches.entries()) {
    const score = 1 / (60 + rank)
    const existing = docMap.get(m.documentId)
    if (existing) existing.score += score
    else {
      docMap.set(m.documentId, {
        id: m.documentId, type: "document", documentId: m.documentId,
        filename: m.filename, score,
      })
    }
    snippets.push({
      id: `${m.documentId}:${m.page}:${rank}`,
      type: "snippet",
      documentId: m.documentId,
      filename: m.filename,
      page: m.page,
      bbox: m.bbox,
      snippet: m.snippet,
      score,
    })
  }

  for (const [rank, m] of contentMatches.entries()) {
    const score = 1 / (60 + rank)
    const existing = docMap.get(m.documentId)
    if (existing) existing.score += score
    else {
      docMap.set(m.documentId, {
        id: m.documentId, type: "document", documentId: m.documentId,
        filename: m.filename, score,
      })
    }
  }

  const docs = Array.from(docMap.values()).sort((a, b) => b.score - a.score)
  return [...docs, ...snippets.sort((a, b) => b.score - a.score)]
}
