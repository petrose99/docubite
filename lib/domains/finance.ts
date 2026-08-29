/** The finance domain pack: the core seeded set (invoice, receipt, expense_receipt, generic) plus
 * an optional set (bank_statement, purchase_order, remittance_advice, supplier_statement) offered
 * as add-on worksheets from the templates settings page — the same domain-pack picker pathology
 * and logistics already use (lib/domains/index.ts's extractionDomainPacks), not a new mechanism.
 *
 * Split on purpose: every one of the optional four is a real, useful worksheet, but seeding all
 * eight into every new file would mean a brand-new user staring at four empty tabs they have no
 * documents for yet. FINANCE_TEMPLATES stays load-bearing (models/files.ts seeds it into every
 * new file); FINANCE_OPTIONAL_TEMPLATES is opt-in the same way pathology/logistics are. */
export const FINANCE_TEMPLATES = [
  {
    code: "invoice", name: "Invoice", documentType: "invoice", isSystem: true, multiRow: true,
    fields: [
      { key: "vendor", label: "Supplier", type: "string", instruction: "Seller or supplier name", required: true },
      { key: "supplier_vat_number", label: "Supplier VAT number", type: "string", instruction: "Supplier's VAT/tax registration number exactly as printed (e.g. GB123456789). Leave blank if not shown — do not infer.", required: false },
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
    code: "expense_receipt", name: "Expense receipt", documentType: "expense_receipt", isSystem: true, multiRow: false,
    fields: [
      { key: "merchant", label: "Merchant", type: "string", instruction: "Store, merchant, or supplier name", required: true },
      { key: "purchase_date", label: "Purchase date", type: "date", instruction: "Date of purchase", required: true },
      { key: "receipt_number", label: "Receipt number", type: "string", instruction: "Receipt or reference number", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "total", label: "Total", type: "number", instruction: "Amount paid including taxes", required: true, mergeStrategy: "last" },
      { key: "tax_total", label: "Tax total", type: "number", instruction: "Total tax or VAT", required: false, mergeStrategy: "last" },
      // Deliberately generic: no hardcoded category or tax-code vocabulary here. A workspace's
      // real vocabulary is its TaxProfile (lib/tax/regions.ts) — WP12's tax-consistency check is
      // what actually compares against it. Read verbatim off the receipt, never invented.
      { key: "tax_code", label: "Tax code", type: "string", instruction: "The tax rate label or exemption code shown on the receipt, exactly as printed (for example a VAT rate band). Leave blank if none is shown — do not infer one.", required: false },
      { key: "category", label: "Category", type: "string", instruction: "An expense category if one is printed or stamped on the receipt. Leave blank if none is shown — do not invent one.", required: false },
      { key: "payment_method", label: "Payment method", type: "string", instruction: "How the purchase was paid, as shown (e.g. cash, card, card last 4 digits)", required: false },
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

/** Offered from the templates settings page's domain-pack picker, never seeded by default — see
 * the header comment above. */
export const FINANCE_OPTIONAL_TEMPLATES = [
  {
    code: "bank_statement", name: "Bank statement", documentType: "bank_statement", isSystem: false, multiRow: true,
    fields: [
      { key: "account_holder", label: "Account holder", type: "string", instruction: "Name on the account, as printed", required: false },
      { key: "account_number", label: "Account number", type: "string", instruction: "Account number, sort code, or IBAN as printed (masked or full)", required: false },
      { key: "statement_period_start", label: "Period start", type: "date", instruction: "First day of the statement period", required: false },
      { key: "statement_period_end", label: "Period end", type: "date", instruction: "Last day of the statement period", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "opening_balance", label: "Opening balance", type: "number", instruction: "Balance at the start of the period", required: false, mergeStrategy: "first" },
      { key: "closing_balance", label: "Closing balance", type: "number", instruction: "Balance at the end of the period", required: false, mergeStrategy: "last" },
      { key: "transactions", label: "Transactions", type: "array", instruction: "Every transaction row in the statement, in the order printed", required: false, itemFields: [
        { key: "transaction_date", label: "Date", type: "date", instruction: "Date of the transaction", required: false },
        { key: "description", label: "Description", type: "string", instruction: "Transaction description as printed", required: false },
        { key: "debit", label: "Money out", type: "number", instruction: "Amount debited (money leaving the account), if any", required: false },
        { key: "credit", label: "Money in", type: "number", instruction: "Amount credited (money entering the account), if any", required: false },
        { key: "running_balance", label: "Balance", type: "number", instruction: "Running balance after this transaction, if shown", required: false },
      ] },
    ],
  },
  {
    code: "purchase_order", name: "Purchase order", documentType: "purchase_order", isSystem: false, multiRow: true,
    fields: [
      { key: "po_number", label: "PO number", type: "string", instruction: "Purchase order number", required: true },
      { key: "supplier", label: "Supplier", type: "string", instruction: "Supplier or vendor name", required: true },
      { key: "order_date", label: "Order date", type: "date", instruction: "Date the order was placed", required: false },
      { key: "delivery_date", label: "Delivery date", type: "date", instruction: "Requested or expected delivery date", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "total", label: "Total", type: "number", instruction: "Total order amount", required: false, mergeStrategy: "last" },
      { key: "line_items", label: "Line items", type: "array", instruction: "Each ordered line item", required: false, itemFields: [
        { key: "description", label: "Description", type: "string", instruction: "What was ordered", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity ordered", required: false },
        { key: "unit_price", label: "Unit price", type: "number", instruction: "Price per unit", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Line total", required: false },
      ] },
    ],
  },
  {
    code: "remittance_advice", name: "Remittance advice", documentType: "remittance_advice", isSystem: false, multiRow: true,
    fields: [
      { key: "payer", label: "Payer", type: "string", instruction: "Who is making the payment", required: false },
      { key: "payee", label: "Payee", type: "string", instruction: "Who is being paid", required: false },
      { key: "remittance_date", label: "Remittance date", type: "date", instruction: "Date of the payment", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "total", label: "Total remitted", type: "number", instruction: "Total amount paid across every allocation", required: false, mergeStrategy: "last" },
      { key: "allocations", label: "Allocations", type: "array", instruction: "Each invoice this payment is applied against", required: false, itemFields: [
        { key: "invoice_number", label: "Invoice number", type: "string", instruction: "The invoice this line pays, as printed", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Amount allocated to this invoice", required: false },
      ] },
    ],
  },
  {
    code: "supplier_statement", name: "Supplier statement", documentType: "supplier_statement", isSystem: false, multiRow: true,
    fields: [
      { key: "supplier", label: "Supplier", type: "string", instruction: "Supplier or vendor name", required: true },
      { key: "statement_date", label: "Statement date", type: "date", instruction: "Date the statement was issued", required: false },
      { key: "currency_code", label: "Currency shown", type: "string", instruction: "Literal ISO 4217 code printed on the document; do not convert", required: false },
      { key: "closing_balance", label: "Closing balance", type: "number", instruction: "Balance owed as of the statement date", required: false, mergeStrategy: "last" },
      { key: "entries", label: "Entries", type: "array", instruction: "Each line on the statement, in the order printed", required: false, itemFields: [
        { key: "entry_date", label: "Date", type: "date", instruction: "Date of the entry", required: false },
        { key: "description", label: "Description", type: "string", instruction: "Entry description as printed (e.g. an invoice or payment reference)", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Amount of this entry", required: false },
        { key: "running_balance", label: "Balance", type: "number", instruction: "Running balance after this entry, if shown", required: false },
      ] },
    ],
  },
] as const

/** Terms an ASR pass should be biased towards for this domain (Stage 3). Finance dictation is not
 * a use case today, so the list is the handful of tokens speech models reliably mangle. */
export const FINANCE_BIAS_TERMS = ["invoice", "VAT", "IBAN", "purchase order", "net 30", "subtotal"] as const
