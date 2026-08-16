import type { DocumentFieldDefinition } from "@/lib/document-templates"

type ExportableDocument = {
  filename: string
  status: string
  receivedAt: Date
  reviewedData: unknown
  rawExtraction: unknown
}

function documentData(document: ExportableDocument): Record<string, unknown> {
  return (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
}

function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === "object") return JSON.stringify(value)
  return value
}

const PREFIX_COLUMNS = ["filename", "status", "received_at"] as const

export function documentExportRow(document: ExportableDocument, fields: DocumentFieldDefinition[]): Record<string, unknown> {
  const data = documentData(document)
  const row: Record<string, unknown> = {
    filename: document.filename,
    status: document.status,
    received_at: document.receivedAt.toISOString(),
  }
  for (const field of fields) {
    if (field.type === "array" && field.itemFields?.length) {
      const items = Array.isArray(data[field.key]) ? data[field.key] as unknown[] : []
      row[field.key] = `${items.length} item${items.length === 1 ? "" : "s"}`
    } else {
      row[field.key] = cellValue(data[field.key])
    }
  }
  return row
}

export function lineItemExportRows(document: ExportableDocument, fields: DocumentFieldDefinition[]): Record<string, unknown>[] {
  const data = documentData(document)
  const rows: Record<string, unknown>[] = []
  for (const field of fields) {
    if (field.type !== "array" || !field.itemFields?.length) continue
    const items = Array.isArray(data[field.key]) ? data[field.key] as Record<string, unknown>[] : []
    for (const item of items) {
      const row: Record<string, unknown> = {
        filename: document.filename,
        status: document.status,
        received_at: document.receivedAt.toISOString(),
      }
      for (const f of fields) {
        if (f.type === "array") continue
        row[f.key] = cellValue(data[f.key])
      }
      for (const itemField of field.itemFields) {
        row[`item_${itemField.key}`] = cellValue(item[itemField.key])
      }
      rows.push(row)
    }
  }
  return rows
}

/** Flattens one document's data into grid rows, one per entry of its first line-item table,
 * keeping raw (unstringified) values plus the item's position so a cell edit can write back
 * into the parent array. Documents without table rows still yield one row (itemIndex null)
 * so they stay visible in a multi-row grid. */
export function flattenedItemRows(data: Record<string, unknown>, fields: DocumentFieldDefinition[]): Array<{ arrayKey: string | null; itemIndex: number | null; item: Record<string, unknown> }> {
  const arrayField = fields.find((field) => field.type === "array" && field.itemFields?.length)
  const rawItems = arrayField && Array.isArray(data[arrayField.key]) ? (data[arrayField.key] as unknown[]) : []
  // itemIndex keeps the position in the ORIGINAL array (not the filtered one), because edits
  // write back through it and must land on the entry the user actually saw.
  const items = rawItems.map((item, itemIndex) => ({ item, itemIndex })).filter((entry): entry is { item: Record<string, unknown>; itemIndex: number } => !!entry.item && typeof entry.item === "object" && !Array.isArray(entry.item))
  if (!arrayField || !items.length) return [{ arrayKey: arrayField?.key ?? null, itemIndex: null, item: {} }]
  return items.map(({ item, itemIndex }) => ({ arrayKey: arrayField.key, itemIndex, item }))
}

export function exportColumns(fields: DocumentFieldDefinition[], sheet: "documents" | "line_items"): string[] {
  const cols = [...PREFIX_COLUMNS] as string[]
  if (sheet === "documents") {
    for (const field of fields) cols.push(field.key)
  } else {
    for (const field of fields) {
      if (field.type === "array") continue
      cols.push(field.key)
    }
    for (const field of fields) {
      if (field.type !== "array" || !field.itemFields?.length) continue
      for (const itemField of field.itemFields) cols.push(`item_${itemField.key}`)
    }
  }
  return cols
}

export function exportColumnLabels(fields: DocumentFieldDefinition[], sheet: "documents" | "line_items"): Record<string, string> {
  const labels: Record<string, string> = { filename: "Filename", status: "Status", received_at: "Received at" }
  if (sheet === "documents") {
    for (const field of fields) labels[field.key] = field.label
  } else {
    for (const field of fields) {
      if (field.type === "array") continue
      labels[field.key] = field.label
    }
    for (const field of fields) {
      if (field.type !== "array" || !field.itemFields?.length) continue
      for (const itemField of field.itemFields) labels[`item_${itemField.key}`] = itemField.label
    }
  }
  return labels
}
