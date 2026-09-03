import { prisma } from "@/lib/db"
import { randomUUID } from "crypto"

const INVOICE_FIELDS = [
  { key: "vendor", label: "Vendor", type: "string", instruction: "", required: true },
  { key: "invoice_number", label: "Invoice Number", type: "string", instruction: "", required: true },
  { key: "issue_date", label: "Issue Date", type: "date", instruction: "", required: true },
  { key: "due_date", label: "Due Date", type: "date", instruction: "", required: false },
  { key: "subtotal", label: "Subtotal", type: "number", instruction: "", required: false },
  { key: "tax_total", label: "Tax", type: "number", instruction: "", required: false },
  { key: "total", label: "Total", type: "number", instruction: "", required: true },
  { key: "currency", label: "Currency", type: "string", instruction: "", required: false },
]

const RECEIPT_FIELDS = [
  { key: "merchant", label: "Merchant", type: "string", instruction: "", required: true },
  { key: "date", label: "Date", type: "date", instruction: "", required: true },
  { key: "total", label: "Total", type: "number", instruction: "", required: true },
  { key: "payment_method", label: "Payment Method", type: "string", instruction: "", required: false },
  { key: "category", label: "Category", type: "string", instruction: "", required: false },
]

const SAMPLE_INVOICES = [
  { vendor: "Acme Corp", invoice_number: "INV-2026-001", issue_date: "2026-07-15", due_date: "2026-08-15", subtotal: "4500.00", tax_total: "675.00", total: "5175.00", currency: "USD" },
  { vendor: "TechSupply Inc", invoice_number: "TS-8834", issue_date: "2026-08-01", due_date: "2026-09-01", subtotal: "1200.00", tax_total: "180.00", total: "1380.00", currency: "USD" },
  { vendor: "CloudHost Pro", invoice_number: "CH-2026-0092", issue_date: "2026-08-10", due_date: "2026-09-10", subtotal: "899.00", tax_total: "134.85", total: "1033.85", currency: "USD" },
  { vendor: "Office Essentials", invoice_number: "OE-44210", issue_date: "2026-08-20", due_date: "2026-09-20", subtotal: "340.00", tax_total: "51.00", total: "391.00", currency: "USD" },
]

const SAMPLE_RECEIPTS = [
  { merchant: "Uber", date: "2026-08-12", total: "24.50", payment_method: "Credit Card", category: "Transport" },
  { merchant: "Starbucks", date: "2026-08-13", total: "8.75", payment_method: "Debit Card", category: "Meals" },
  { merchant: "Amazon Web Services", date: "2026-08-15", total: "156.32", payment_method: "Credit Card", category: "Software" },
]

async function main() {
  const targetId = process.argv[2] || null
  const workspace = targetId
    ? await prisma.workspace.findUnique({ where: { id: targetId } })
    : await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } })
  if (!workspace) throw new Error("No workspace found — run db:seed first, or pass workspace id as argument")

  // Find the pipeline file to attach docs to (or any sheet file)
  const pipelineFile = await prisma.documentFile.findFirst({ where: { workspaceId: workspace.id, kind: "pipeline" } })
  const anyFile = pipelineFile ?? await prisma.documentFile.findFirst({ where: { workspaceId: workspace.id } })
  if (!anyFile) throw new Error("No file found — run db:seed first")

  // Find or create Invoice template
  let invoiceTemplate = await prisma.documentTemplate.findFirst({ where: { workspaceId: workspace.id, code: "invoice" } })
  if (!invoiceTemplate) {
    invoiceTemplate = await prisma.documentTemplate.create({
      data: {
        workspaceId: workspace.id, fileId: anyFile.id, code: "invoice", name: "Invoice",
        documentType: "invoice", isSystem: true, multiRow: true,
        versions: { create: { version: 1, fields: INVOICE_FIELDS } },
      },
    })
  }
  const invoiceVersion = await prisma.documentTemplateVersion.findFirst({ where: { templateId: invoiceTemplate.id }, orderBy: { version: "desc" } })

  // Find or create Receipt template
  let receiptTemplate = await prisma.documentTemplate.findFirst({ where: { workspaceId: workspace.id, code: "receipt" } })
  if (!receiptTemplate) {
    receiptTemplate = await prisma.documentTemplate.create({
      data: {
        workspaceId: workspace.id, fileId: anyFile.id, code: "receipt", name: "Receipt",
        documentType: "receipt", isSystem: true, multiRow: true,
        versions: { create: { version: 1, fields: RECEIPT_FIELDS } },
      },
    })
  }
  const receiptVersion = await prisma.documentTemplateVersion.findFirst({ where: { templateId: receiptTemplate.id }, orderBy: { version: "desc" } })

  let created = 0

  for (const inv of SAMPLE_INVOICES) {
    await prisma.document.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        fileId: anyFile.id,
        templateId: invoiceTemplate.id,
        templateVersionId: invoiceVersion?.id ?? null,
        source: "seed",
        status: "reviewed",
        filename: `${inv.vendor.toLowerCase().replace(/\s+/g, "-")}-${inv.invoice_number}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 50000,
        sha256: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        fieldSnapshot: INVOICE_FIELDS,
        reviewedData: inv,
        rawExtraction: inv,
        confidence: Object.fromEntries(Object.keys(inv).map((k) => [k, 0.95])),
      },
    })
    created++
  }

  for (const rec of SAMPLE_RECEIPTS) {
    await prisma.document.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        fileId: anyFile.id,
        templateId: receiptTemplate.id,
        templateVersionId: receiptVersion?.id ?? null,
        source: "seed",
        status: "reviewed",
        filename: `${rec.merchant.toLowerCase().replace(/\s+/g, "-")}-receipt.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 25000,
        sha256: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        fieldSnapshot: RECEIPT_FIELDS,
        reviewedData: rec,
        rawExtraction: rec,
        confidence: Object.fromEntries(Object.keys(rec).map((k) => [k, 0.92])),
      },
    })
    created++
  }

  console.log(`\nCreated ${created} sample documents (${SAMPLE_INVOICES.length} invoices, ${SAMPLE_RECEIPTS.length} receipts)`)
  console.log(`Workspace: ${workspace.name} (${workspace.id})`)
  console.log(`File: ${anyFile.name} (${anyFile.id})\n`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
