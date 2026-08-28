import { FileText, FlaskConical, HardHat, Landmark, Mic, PenLine, Plug, Receipt, ScanLine, Sheet, ShieldCheck, Truck, type LucideIcon } from "lucide-react"

/** The Solutions mega-menu and the /solutions/[slug] pages read from this one list, so a new
 * solution is a single entry here rather than a page plus a nav edit that can drift apart.
 *
 * `group` drives the two menu columns: what the document *is* versus what condition it arrives
 * in — the two questions a prospect actually asks before they believe extraction will work. */
export type SolutionGroup = "type" | "quality"

export type Solution = {
  slug: string
  group: SolutionGroup
  /** Menu label and page eyebrow. */
  name: string
  /** The one-liner under the label in the mega-menu. */
  tagline: string
  icon: LucideIcon
  title: string
  description: string
  /** Chips under the hero: the fields this document kind is read for. */
  fields: string[]
  points: { title: string; text: string }[]
}

export const SOLUTION_GROUPS: { id: SolutionGroup; label: string }[] = [
  { id: "type", label: "By document type" },
  { id: "quality", label: "By document quality" },
]

export const SOLUTIONS: Solution[] = [
  {
    slug: "invoices",
    group: "type",
    name: "Invoices",
    tagline: "Supplier, number, dates, line items, tax",
    icon: FileText,
    title: "Invoice data extraction that survives real supplier PDFs",
    description: "Pull supplier, invoice number, dates, totals, tax and line items out of every supplier invoice — whatever layout it arrives in — and review the result before it reaches your ledger.",
    fields: ["Supplier name", "Invoice number", "Issue date", "Due date", "Net total", "Tax amount", "Gross total", "Currency", "Line items"],
    points: [
      { title: "Every supplier has a different layout", text: "Templates key on what a field means, not where it sits on the page, so a new supplier does not need a new template — the same invoice template reads all of them. Repeat suppliers are recognised by shape before any AI runs — the same setup applies itself." },
      { title: "Line items come out as rows, not a blob", text: "Repeating item tables are extracted into their own rows with description, quantity, unit price and tax, ready to export alongside the header fields." },
      { title: "Totals are checked, not assumed", text: "Values the model was unsure about are flagged for review rather than quietly filled in, so a misread tax amount is something you correct, not something you discover in a reconciliation." },
    ],
  },
  {
    slug: "receipts",
    group: "type",
    name: "Receipts",
    tagline: "Merchant, date, total, tax, line items",
    icon: Receipt,
    title: "Turn a shoebox of receipts into expense rows",
    description: "Photographed till receipts, crumpled thermal paper and emailed PDFs all read into the same clean set of expense fields, ready for review and CSV export.",
    fields: ["Merchant", "Purchase date", "Receipt number", "Total", "Tax total", "Line items", "Currency"],
    points: [
      { title: "Phone photos are the normal case", text: "Receipts arrive as camera snaps at an angle, in bad light, on curled thermal paper. Pages that local text extraction cannot read are sent down the vision path instead of failing." },
      { title: "Faded thermal print still resolves", text: "Low-contrast thermal receipts are the single most common reason extraction fails elsewhere. They are handled as a first-class case, not an edge case." },
      { title: "One row per receipt, in the shape you export", text: "Fields land in a reviewable sheet, so the handoff to your bookkeeping workflow is a CSV you already know the columns of." },
    ],
  },
  {
    slug: "expense-receipts",
    group: "type",
    name: "Expense receipts",
    tagline: "Merchant, total, tax code, category, payment method",
    icon: Receipt,
    title: "Receipts read straight to a categorized expense feed",
    description: "The Expense receipt worksheet reads a receipt into one row — merchant, total, tax code and payment method as printed, plus a category when the receipt itself shows one — ready to review and export without touching a line-item table first.",
    fields: ["Merchant", "Purchase date", "Total", "Tax total", "Tax code", "Category", "Payment method", "Currency"],
    points: [
      { title: "One row per receipt, not a line-item table", text: "Add the Expense receipt worksheet from Settings when you want fast categorization rather than an itemized breakdown — the same Receipt worksheet with line items is still there when you need it." },
      { title: "Category is read, never invented", text: "If the receipt itself is stamped or annotated with a category, it comes through; if not, the field is left blank rather than guessed at." },
      { title: "Tax code is read verbatim", text: "Whatever rate label or exemption code is printed on the receipt lands in the field as printed — matching it against your configured tax rates is a review step, not something extraction assumes for you." },
    ],
  },
  {
    slug: "bank-statements",
    group: "type",
    name: "Bank statements",
    tagline: "Multi-page transaction tables into rows",
    icon: Landmark,
    title: "Bank statement PDFs, read as transaction tables",
    description: "Multi-page statements come back as structured transaction rows — date, description, money in, money out, running balance — with the account header captured alongside them. Add the Bank statement worksheet from Settings; it isn't seeded by default.",
    fields: ["Account holder", "Account number", "Statement period", "Opening balance", "Closing balance", "Transaction rows"],
    points: [
      { title: "Tables that run across pages stay one table", text: "Statements are processed in page batches and the transaction rows are stitched back together, so a table broken by a page header does not become two half-tables." },
      { title: "Money in and money out stay apart", text: "Debit and credit columns are extracted as distinct fields rather than one signed number, which is what makes the export usable without a second cleanup pass." },
      { title: "Balances give you a check to run", text: "Opening and closing balances come out with the rows, so the arithmetic can be verified before anyone trusts the data." },
    ],
  },
  {
    slug: "handwritten-documents",
    group: "quality",
    name: "Handwritten documents",
    tagline: "Delivery notes, forms, annotated invoices",
    icon: PenLine,
    title: "Handwriting that other extraction tools skip",
    description: "Signed delivery notes, filled-in paper forms and invoices with a scribbled correction in the margin. Handwritten pages are read rather than coming back empty.",
    fields: ["Written values", "Filled form fields", "Margin annotations", "Signatures present", "Dates", "Quantities"],
    points: [
      { title: "Handwriting is not a special case", text: "The parser that reads a laser-printed invoice reads a handwritten delivery note the same way, so a filled-in form does not come back as an empty page." },
      { title: "Annotations are content, not noise", text: "A quantity crossed out and rewritten by hand is the value that matters. Extraction instructions can say so, so the corrected figure is the one that lands in the field." },
      { title: "Low confidence is surfaced, not hidden", text: "Handwriting is where a confident wrong answer costs the most. Uncertain fields arrive flagged for a human to settle." },
    ],
  },
  {
    slug: "scanned-pdfs",
    group: "quality",
    name: "Scanned PDFs",
    tagline: "Image-only PDFs, faxes, photocopies",
    icon: ScanLine,
    title: "Image-only PDFs with no text layer at all",
    description: "A scanned PDF is a picture of a page in a PDF wrapper — copy and paste gets you nothing. Every page is parsed into text before any field is extracted from it.",
    fields: ["Any template field", "Page text", "Tables", "Stamps and headers", "Multi-page documents"],
    points: [
      { title: "Only text reaches the model", text: "The document is parsed into text first, and that text is what gets sent on for structuring — the page image itself never reaches the AI model." },
      { title: "Skew, speckle and photocopy grey", text: "Third-generation photocopies and fax-quality scans are what the parser is built for, so a bad scan is read rather than refused." },
      { title: "Long documents are batched, not truncated", text: "Multi-page scans are processed in batches so a forty-page bundle comes back whole rather than stopping at whatever fitted in one request." },
    ],
  },
]

export type Industry = {
  icon: LucideIcon
  name: string
  tagline: string
  tags: string[]
  before: string[]
  after: string[]
}

/** The industries teased on the homepage and detailed on /solutions#industries. Shared here (like
 * SOLUTIONS) so the two pages can never drift on which industries exist or what they're called. */
export const INDUSTRIES: Industry[] = [
  {
    icon: Landmark,
    name: "Finance & bookkeeping",
    tagline: "Month-end shouldn't mean a keyboard and a shoebox of receipts.",
    tags: ["Supplier invoices", "Expense receipts", "Bank statements", "Remittance advice"],
    before: [
      "Open each PDF and retype supplier, date, net, VAT, total",
      "Squint at photographed receipts and faded thermal paper",
      "Hunt for the source PDF when a figure looks wrong",
    ],
    after: [
      "Drop the whole folder — invoices, receipts, statements — and get back the duplicates first",
      "Fields land as rows; low-confidence ones flag themselves",
      "Total per supplier with the assistant, click any figure to its line",
    ],
  },
  {
    icon: FlaskConical,
    name: "Healthcare & clinics",
    tagline: "Less admin between the patient and the record.",
    tags: ["Referral letters", "Lab result sheets", "Insurance claim forms", "Intake & consent forms"],
    before: [
      "Re-key referral and intake forms into the system by hand",
      "Copy values off faxed, scanned or handwritten result sheets",
      "Chase which form a value came from when a claim is queried",
    ],
    after: [
      "Scan or upload the form — handwriting and faxes read fine",
      "One template pulls the same fields every time, into a clean row",
      "Every value stays pinned to the form it was read from, for the audit trail",
    ],
  },
  {
    icon: Truck,
    name: "Logistics & supply chain",
    tagline: "When the paperwork moves slower than the freight.",
    tags: ["Bills of lading", "Delivery notes / PODs", "Packing lists", "Customs declarations"],
    before: [
      "Type BOL and delivery-note numbers off crumpled, signed paper",
      "Match packing lists to invoices, line by line",
      "Key customs fields under a clearance deadline",
    ],
    after: [
      "Photograph the signed POD or drop the BOL PDF",
      "Line items come out as rows — quantities and refs structured, not a blob",
      "Ask the assistant to flag mismatches across the whole shipment folder, and diff this month's paperwork against last month's",
    ],
  },
  {
    icon: HardHat,
    name: "Construction",
    tagline: "Job-cost paperwork shouldn't lag the job by a month.",
    tags: ["Subcontractor invoices", "Lien waivers", "Delivery tickets", "Timesheets", "Change orders"],
    before: [
      "Re-key subcontractor invoices against the wrong job or cost code",
      "Chase down which lien waivers are conditional versus unconditional before releasing payment",
      "Total timesheets and delivery tickets by hand at the end of the period",
    ],
    after: [
      "Drop subcontractor invoices, waivers, tickets and timesheets in together",
      "Retention, cost codes and waiver type land as their own fields, not buried in a scan",
      "Ask the assistant which change orders are still pending approval, across every job",
    ],
  },
]

/** The homepage's Product mega-menu, and the footer's Product column. Anchors into homepage
 * sections rather than dedicated pages — every target already exists and carries an id. */
export type ProductLink = { href: string; name: string; tagline: string; icon: LucideIcon }

// Anchors point at /accounting or /clinical, not the homepage — the homepage is a light chooser
// (WP6) and no longer carries the deep sections these ids live on.
export const PRODUCT_LINKS: ProductLink[] = [
  { href: "/accounting#extraction", name: "Document extraction", tagline: "Invoices, receipts and scans into a live sheet", icon: FileText },
  { href: "/clinical#dictation", name: "Dictation", tagline: "Speak a document into existence, nothing invented", icon: Mic },
  { href: "/accounting#how", name: "AI in the sheet", tagline: "=AI() runs on your data, without leaving the cell", icon: Sheet },
  { href: "/accounting#folders", name: "Folder reports", tagline: "Duplicates, gaps and what needs attention", icon: FileText },
  { href: "/accounting#integrations", name: "Integrations & API", tagline: "QuickBooks, Xero, and a webhook-backed REST API", icon: Plug },
  { href: "/accounting#security", name: "Security & compliance", tagline: "HIPAA mode, audit trail, malware scanning", icon: ShieldCheck },
]

export const getSolution = (slug: string) => SOLUTIONS.find((solution) => solution.slug === slug)

export const solutionsByGroup = (group: SolutionGroup) => SOLUTIONS.filter((solution) => solution.group === group)
