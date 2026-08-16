import { FileText, IdCard, Landmark, PenLine, Receipt, ScanLine, type LucideIcon } from "lucide-react"

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
      { title: "Every supplier has a different layout", text: "Templates key on what a field means, not where it sits on the page, so a new supplier does not need a new template — the same invoice template reads all of them." },
      { title: "Line items come out as rows, not a blob", text: "Repeating item tables are extracted into their own rows with description, quantity, unit price and tax, ready to export alongside the header fields." },
      { title: "Totals are checked, not assumed", text: "Values the model was unsure about are flagged for review rather than quietly filled in, so a misread tax amount is something you correct, not something you discover in a reconciliation." },
    ],
  },
  {
    slug: "receipts",
    group: "type",
    name: "Receipts",
    tagline: "Merchant, date, total, VAT, payment method",
    icon: Receipt,
    title: "Turn a shoebox of receipts into expense rows",
    description: "Photographed till receipts, crumpled thermal paper and emailed PDFs all read into the same clean set of expense fields, ready for review and CSV export.",
    fields: ["Merchant", "Purchase date", "Total", "VAT / sales tax", "Payment method", "Card last 4", "Category", "Currency"],
    points: [
      { title: "Phone photos are the normal case", text: "Receipts arrive as camera snaps at an angle, in bad light, on curled thermal paper. Pages that local text extraction cannot read are sent down the vision path instead of failing." },
      { title: "Faded thermal print still resolves", text: "Low-contrast thermal receipts are the single most common reason extraction fails elsewhere. They are handled as a first-class case, not an edge case." },
      { title: "One row per receipt, in the shape you export", text: "Fields land in a reviewable sheet, so the handoff to your bookkeeping workflow is a CSV you already know the columns of." },
    ],
  },
  {
    slug: "bank-statements",
    group: "type",
    name: "Bank statements",
    tagline: "Multi-page transaction tables into rows",
    icon: Landmark,
    title: "Bank statement PDFs, read as transaction tables",
    description: "Multi-page statements come back as structured transaction rows — date, description, money in, money out, running balance — with the account header captured alongside them.",
    fields: ["Account holder", "Account number", "Sort code / IBAN", "Statement period", "Opening balance", "Closing balance", "Transaction rows"],
    points: [
      { title: "Tables that run across pages stay one table", text: "Statements are processed in page batches and the transaction rows are stitched back together, so a table broken by a page header does not become two half-tables." },
      { title: "Money in and money out stay apart", text: "Debit and credit columns are extracted as distinct fields rather than one signed number, which is what makes the export usable without a second cleanup pass." },
      { title: "Balances give you a check to run", text: "Opening and closing balances come out with the rows, so the arithmetic can be verified before anyone trusts the data." },
    ],
  },
  {
    slug: "ids",
    group: "type",
    name: "IDs",
    tagline: "Passports, driving licences, national IDs",
    icon: IdCard,
    title: "Identity documents, read into the fields you actually need",
    description: "Passports, driving licences and national ID cards read into name, document number, dates and issuing country — captured for onboarding checks and held in private encrypted storage.",
    fields: ["Full name", "Date of birth", "Document number", "Document type", "Issuing country", "Issue date", "Expiry date", "MRZ lines"],
    points: [
      { title: "The machine-readable zone is a field too", text: "Where a document carries an MRZ, it is captured as its own value alongside the printed fields, so the two can be checked against each other." },
      { title: "Photos of cards, not flatbed scans", text: "ID documents are almost always photographed in hand, with glare and a cropped edge. That is the input the vision path is tuned for." },
      { title: "Handled as sensitive by default", text: "Sources sit in private encrypted storage, access is scoped to the workspace that uploaded them, and document bodies are never written to logs." },
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

export const getSolution = (slug: string) => SOLUTIONS.find((solution) => solution.slug === slug)

export const solutionsByGroup = (group: SolutionGroup) => SOLUTIONS.filter((solution) => solution.group === group)
