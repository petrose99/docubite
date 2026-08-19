/** The finance domain pack: invoice, receipt, and the domain-agnostic generic template.
 *
 * Moved here verbatim from lib/document-templates, which now re-exports it as
 * DEFAULT_DOCUMENT_TEMPLATES. These three and only these three are seeded into every new file
 * (models/files.ts), so this pack's contents are load-bearing — adding a template here adds a
 * worksheet to every file anyone creates. New domains go in their own pack and are opted into. */
export const FINANCE_TEMPLATES = [
  {
    code: "invoice", name: "Invoice", documentType: "invoice", isSystem: true, multiRow: true,
    fields: [
      { key: "vendor", label: "Supplier", type: "string", instruction: "Seller or supplier name", required: true },
      { key: "invoice_number", label: "Invoice number", type: "string", instruction: "Invoice, bill, or reference number", required: true },
      { key: "issue_date", label: "Issue date", type: "date", instruction: "Date the invoice was issued", required: true },
      { key: "due_date", label: "Due date", type: "date", instruction: "Payment due date", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "subtotal", label: "Subtotal", type: "number", instruction: "Amount before tax", required: false, mergeStrategy: "last" },
      { key: "tax_total", label: "Tax total", type: "number", instruction: "Total tax or VAT", required: false, mergeStrategy: "last" },
      { key: "total", label: "Total", type: "number", instruction: "Amount payable including taxes", required: true, mergeStrategy: "last" },
      { key: "line_items", label: "Line items", type: "array", instruction: "Each billed line item", required: false, itemFields: [
        { key: "description", label: "Description", type: "string", instruction: "What was billed", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity billed", required: false },
        { key: "unit_price", label: "Unit price", type: "number", instruction: "Price per unit before tax", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Line total", required: false },
      ] },
    ],
  },
  {
    code: "receipt", name: "Receipt", documentType: "receipt", isSystem: true, multiRow: true,
    fields: [
      { key: "merchant", label: "Merchant", type: "string", instruction: "Store, merchant, or supplier name", required: true },
      { key: "purchase_date", label: "Purchase date", type: "date", instruction: "Date of purchase", required: true },
      { key: "receipt_number", label: "Receipt number", type: "string", instruction: "Receipt or reference number", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "tax_total", label: "Tax total", type: "number", instruction: "Total tax or VAT", required: false, mergeStrategy: "last" },
      { key: "line_items", label: "Line items", type: "array", instruction: "Each purchased item", required: false, itemFields: [
        { key: "description", label: "Description", type: "string", instruction: "What was purchased", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity purchased", required: false },
        { key: "unit_price", label: "Unit price", type: "number", instruction: "Price per unit before tax", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Line total", required: false },
      ] },
      { key: "total", label: "Total", type: "number", instruction: "Amount paid including taxes", required: true, mergeStrategy: "last" },
    ],
  },
  {
    code: "generic", name: "Custom document", documentType: "generic", isSystem: true, multiRow: false,
    fields: [
      { key: "title", label: "Title", type: "string", instruction: "Short factual title", required: true },
      { key: "document_date", label: "Document date", type: "date", instruction: "Date shown on the document", required: false },
      { key: "summary", label: "Summary", type: "string", instruction: "One concise factual summary, three sentences maximum", required: false },
    ],
  },
] as const

/** Terms an ASR pass should be biased towards for this domain (Stage 3). Finance dictation is not
 * a use case today, so the list is the handful of tokens speech models reliably mangle. */
export const FINANCE_BIAS_TERMS = ["invoice", "VAT", "IBAN", "purchase order", "net 30", "subtotal"] as const
