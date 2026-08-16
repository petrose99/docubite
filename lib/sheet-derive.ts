import { flattenedItemRows } from "@/lib/document-export"
import type { DocumentFieldDefinition } from "@/lib/document-templates"

/** One spreadsheet column: a template field, or one column of the line-item table expanded out
 * when the worksheet is in multi-row mode. */
export type SheetColumn = {
  id: string
  label: string
  type: string
  /** The template field this column reads, which for an item column is the array field. */
  fieldKey: string
  /** Set only for item columns: the key inside each array entry. */
  itemKey: string | null
}

/** One spreadsheet row. A single-row worksheet produces one per document; a multi-row one
 * produces one per line item, with the document's scalar fields repeated down each. */
export type SheetRow = {
  documentId: string
  filename: string
  itemIndex: number | null
  values: Record<string, unknown>
  fieldConfidence: Record<string, number>
  missingRequired: string[]
}

export type DerivedSheet = { columns: SheetColumn[]; rows: SheetRow[]; multiRow: boolean }

/** The documents this needs, narrowed to the columns it actually reads, so both the sheet page
 * and the shared page can pass their own query results in. */
export type DerivableDocument = {
  id: string
  filename: string
  reviewedData: unknown
  rawExtraction: unknown
  confidence: unknown
}

/** Turns a worksheet's fields and its extracted documents into the grid that represents them.
 *
 * This lived twice — once in the sheet page, once in the shared page — and the two copies had
 * to be kept identical by hand or a shared link would show different columns from the file it
 * points at. */
export function deriveSheet(fields: DocumentFieldDefinition[], documents: DerivableDocument[], options: { multiRow: boolean }): DerivedSheet {
  const scalarFields = fields.filter((field) => field.type !== "array")
  const arrayField = fields.find((field) => field.type === "array" && field.itemFields?.length)
  const multiRow = options.multiRow && !!arrayField

  const columns: SheetColumn[] = [
    ...scalarFields.map((field): SheetColumn => ({ id: field.key, label: field.label, type: field.type, fieldKey: field.key, itemKey: null })),
    ...(multiRow && arrayField
      ? arrayField.itemFields!.map((item): SheetColumn => ({ id: `item_${item.key}`, label: item.label, type: item.type, fieldKey: arrayField.key, itemKey: item.key }))
      : fields.filter((field) => field.type === "array").map((field): SheetColumn => ({ id: field.key, label: field.label, type: "array", fieldKey: field.key, itemKey: null }))),
  ]

  const rows = documents.flatMap((document): SheetRow[] => {
    const confidence = document.confidence as { missingRequiredFields?: string[]; fieldConfidence?: Record<string, number> } | null
    // reviewedData is what a human confirmed; rawExtraction is what the model first said.
    const data = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
    const shared = {
      documentId: document.id,
      filename: document.filename,
      fieldConfidence: confidence?.fieldConfidence ?? {},
      missingRequired: confidence?.missingRequiredFields ?? [],
    }

    if (!multiRow || !arrayField) {
      return [{ ...shared, itemIndex: null, values: Object.fromEntries(fields.map((field) => [field.key, data[field.key]])) }]
    }

    return flattenedItemRows(data, fields).map(({ itemIndex, item }): SheetRow => ({
      ...shared,
      itemIndex,
      values: {
        ...Object.fromEntries(scalarFields.map((field) => [field.key, data[field.key]])),
        ...Object.fromEntries((arrayField.itemFields || []).map((itemField) => [`item_${itemField.key}`, item[itemField.key]])),
      },
    }))
  })

  return { columns, rows, multiRow }
}
