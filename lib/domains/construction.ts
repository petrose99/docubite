/** The construction domain pack: subcontractor billing and job-cost documents.
 *
 * Pattern-parity with lib/domains/logistics.ts — a flat template array plus its own bias terms,
 * registered once in lib/domains/index.ts. `type` on lien_waiver is an enum for the same reason
 * logistics's `status` is: "conditional" vs "unconditional" is a small, closed vocabulary worth
 * constraining rather than leaving to free text. */
export const CONSTRUCTION_TEMPLATES = [
  {
    code: "subcontractor_invoice", name: "Subcontractor invoice", documentType: "subcontractor_invoice", isSystem: false, multiRow: true,
    fields: [
      { key: "contractor", label: "Contractor", type: "string", instruction: "Subcontractor or vendor name", required: true },
      { key: "project", label: "Project / job code", type: "string", instruction: "Project name or job cost code this invoice bills against", required: false },
      { key: "invoice_number", label: "Invoice number", type: "string", instruction: "Invoice or reference number", required: true },
      { key: "period", label: "Billing period", type: "string", instruction: "The date range this invoice covers, as printed", required: false },
      { key: "retention", label: "Retention withheld", type: "number", instruction: "Retention amount withheld from this invoice", required: false, mergeStrategy: "last" },
      { key: "total", label: "Total", type: "number", instruction: "Amount payable", required: true, mergeStrategy: "last" },
      { key: "line_items", label: "Line items", type: "array", instruction: "Each billed line item", required: false, itemFields: [
        { key: "description", label: "Description", type: "string", instruction: "What was billed", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity billed", required: false },
        { key: "unit_price", label: "Unit price", type: "number", instruction: "Price per unit", required: false },
        { key: "amount", label: "Amount", type: "number", instruction: "Line total", required: false },
      ] },
    ],
  },
  {
    code: "lien_waiver", name: "Lien waiver", documentType: "lien_waiver", isSystem: false, multiRow: false,
    fields: [
      { key: "type", label: "Type", type: "enum", instruction: "Whether this waiver is conditional or unconditional, as stated", required: true,
        options: ["conditional", "unconditional"] },
      { key: "through_date", label: "Through date", type: "date", instruction: "The date this waiver covers payment through", required: false },
      { key: "amount", label: "Amount", type: "number", instruction: "Amount this waiver releases a claim for", required: false },
      { key: "claimant", label: "Claimant", type: "string", instruction: "The subcontractor or supplier waiving the lien", required: true },
      { key: "property", label: "Property", type: "string", instruction: "The project or property address the lien applies to", required: false },
    ],
  },
  {
    code: "delivery_ticket", name: "Delivery ticket", documentType: "delivery_ticket", isSystem: false, multiRow: true,
    fields: [
      { key: "supplier", label: "Supplier", type: "string", instruction: "Material supplier name", required: true },
      { key: "ticket_number", label: "Ticket number", type: "string", instruction: "Delivery or ticket number", required: false },
      { key: "delivery_date", label: "Date", type: "date", instruction: "Date of delivery", required: false },
      { key: "materials", label: "Materials", type: "array", instruction: "Each material line delivered", required: false, itemFields: [
        { key: "material", label: "Material", type: "string", instruction: "Material description", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity delivered", required: false },
        { key: "unit", label: "Unit", type: "string", instruction: "Unit of measure, as printed (e.g. cubic yard, ton)", required: false },
      ] },
    ],
  },
  {
    code: "timesheet", name: "Timesheet", documentType: "timesheet", isSystem: false, multiRow: true,
    fields: [
      { key: "worker", label: "Worker", type: "string", instruction: "Worker or crew member name", required: true },
      { key: "work_date", label: "Date", type: "date", instruction: "Date worked", required: true },
      { key: "hours", label: "Hours", type: "number", instruction: "Hours worked", required: true },
      { key: "cost_code", label: "Cost code", type: "string", instruction: "Job cost code this time is charged to, as printed", required: false },
    ],
  },
  {
    code: "change_order", name: "Change order", documentType: "change_order", isSystem: false, multiRow: false,
    fields: [
      { key: "co_number", label: "Change order number", type: "string", instruction: "Change order number or reference", required: true },
      { key: "description", label: "Description", type: "string", instruction: "What the change order covers", required: false },
      { key: "cost_delta", label: "Cost delta", type: "number", instruction: "Change in contract cost (positive for an increase, negative for a decrease)", required: false },
      { key: "schedule_delta", label: "Schedule delta (days)", type: "number", instruction: "Change in schedule, in days (positive for an extension)", required: false },
      { key: "approval_status", label: "Approval status", type: "enum", instruction: "Current approval status, as stated", required: false,
        options: ["pending", "approved", "rejected"] },
    ],
  },
] as const

/** Context-biasing terms for the ASR backend (Stage 3). */
export const CONSTRUCTION_BIAS_TERMS = [
  "subcontractor", "retention", "lien waiver", "change order", "cost code", "job cost",
  "delivery ticket", "timesheet", "conditional waiver", "unconditional waiver", "punch list",
] as const
