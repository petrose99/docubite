/** Provider-agnostic normalization of a reviewed document into a bill shape, shared by both
 * QuickBooks and Xero. Pure: takes the document's already-reviewed data and returns a plain object
 * neither provider's SDK/API knows about yet — lib/integrations/{quickbooks,xero}/bill-mapper.ts each
 * take this and produce the exact provider request body.
 *
 * Field names mirror the finance domain pack (lib/domains/finance.ts): invoice uses vendor/
 * invoice_number/issue_date/due_date, receipt uses merchant/receipt_number/purchase_date (no
 * due_date — a receipt is already paid). Both share total and line_items. */

export type NormalizedLineItem = {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export type NormalizedBill = {
  documentId: string
  filename: string
  vendorName: string
  referenceNumber: string | null
  issueDate: string | null
  dueDate: string | null
  total: number
  lineItems: NormalizedLineItem[]
}

export class BillMappingError extends Error {}

type ReviewedLineItem = { description?: unknown; quantity?: unknown; unit_price?: unknown; amount?: unknown }

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function normalizeLineItems(raw: unknown, total: number): NormalizedLineItem[] {
  const rows = Array.isArray(raw) ? (raw as ReviewedLineItem[]) : []
  const items = rows
    .map((row) => {
      const amount = asNumber(row.amount) ?? 0
      const quantity = asNumber(row.quantity) ?? 1
      const unitPrice = asNumber(row.unit_price) ?? (quantity ? amount / quantity : amount)
      return { description: asString(row.description) ?? "Line item", quantity, unitPrice, amount }
    })
    .filter((item) => item.amount !== 0 || item.description !== "Line item")
  // No usable line items — synthesize one that covers the whole total, so the provider's bill body
  // (which requires at least one line) always has something to post.
  if (!items.length) return [{ description: "Total", quantity: 1, unitPrice: total, amount: total }]
  return items
}

/** Reads vendor/invoice or merchant/receipt fields off a reviewed document and produces a single
 * normalized bill. Throws BillMappingError if there is no total — a bill with no amount is not a
 * bill a provider can create, and this is the one case scope explicitly says to refuse rather than
 * guess. `reviewedData` is expected to be the document's reviewedData (falling back to rawExtraction
 * is the caller's job, matching lib/document-export.ts's convention). */
export function normalizeBillFromDocument(input: {
  documentId: string
  filename: string
  templateCode: string | null
  reviewedData: Record<string, unknown>
}): NormalizedBill {
  const data = input.reviewedData
  const vendorName = asString(data.vendor) ?? asString(data.merchant) ?? "Unknown vendor"
  const referenceNumber = asString(data.invoice_number) ?? asString(data.receipt_number)
  const issueDate = asString(data.issue_date) ?? asString(data.purchase_date)
  // Receipts have no due_date field at all (already paid) — only read it for invoices.
  const dueDate = input.templateCode === "receipt" ? null : asString(data.due_date)
  const total = asNumber(data.total)
  if (total === null) throw new BillMappingError("bill_missing_total")
  const lineItems = normalizeLineItems(data.line_items, total)
  return {
    documentId: input.documentId,
    filename: input.filename,
    vendorName,
    referenceNumber,
    issueDate,
    dueDate,
    total,
    lineItems,
  }
}
