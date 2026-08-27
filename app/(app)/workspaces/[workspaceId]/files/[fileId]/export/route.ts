import { track } from "@/lib/analytics"
import { recordDocumentAudit } from "@/lib/audit"
import { getCurrentUser } from "@/lib/auth"
import { documentExportRow, exportColumnLabels, exportColumns, lineItemExportRows } from "@/lib/document-export"
import { parseTemplateFields } from "@/lib/document-templates"
import { sheetToCsv, snapshotToSheets, snapshotToXlsx } from "@/lib/sheet-export"
import { getWorkbook } from "@/models/spreadsheets"
import { documentDataForExport, listWorkspaceDocuments } from "@/models/documents"
import { getFileTemplates, getWorkspaceFile } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"
import ExcelJS from "exceljs"

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '""'
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return `"${JSON.stringify(value).replaceAll('"', '""')}"`
  return `"${String(value).replaceAll('"', '""')}"`
}

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; fileId: string }> }) {
  const { workspaceId, fileId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) return new Response("File not found", { status: 404 })

  const url = new URL(request.url)
  const templateCode = url.searchParams.get("template")
  const format = url.searchParams.get("format") || "csv"
  const statusFilter = url.searchParams.get("status") || (templateCode ? "all" : "reviewed")
  const sheet = url.searchParams.get("sheet") || "documents"
  const safeName = file.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file"

  // The audit trail otherwise only sees writes (deletes, requeues) and never the action most
  // relevant to a compliance review: someone pulling extracted data out of the system.
  await recordDocumentAudit({ workspaceId, actorId: user.id, type: "file_exported", detail: { fileId, format, templateCode, sheet } })
  await track("document_exported", { fileId, format: format === "xlsx" ? "xlsx" : "csv" }, { workspaceId, actorId: user.id })

  /** Once a file has a spreadsheet, the spreadsheet *is* the file: it holds the columns the user
   * added, the corrections they made and the formulas they wrote, none of which exist in the
   * Documents rows. Exporting from anywhere else would hand them a download missing their own
   * work. The document-derived paths below stay for files that predate the grid. */
  const workbook = await getWorkbook(workspaceId, fileId)
  if (workbook) {
    if (format === "xlsx") {
      const buffer = await snapshotToXlsx(workbook.snapshot)
      return new Response(buffer, { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename=${safeName}.xlsx`,
        "cache-control": "no-store",
      } })
    }

    // CSV is one sheet by definition. An exact sheet-name wins (the grid's Download CSV button
    // sends the active tab's name); otherwise the requested worksheet by template; otherwise the
    // first tab, which is the one the file opens on.
    const sheets = snapshotToSheets(workbook.snapshot)
    const sheetName = url.searchParams.get("sheetName")
    const templates = templateCode ? await getFileTemplates(workspaceId, fileId) : []
    const wanted = templates.find((candidate) => candidate.code === templateCode)?.name
    const chosen = (sheetName && sheets.find((sheet) => sheet.name === sheetName))
      || (wanted && sheets.find((sheet) => sheet.name === wanted))
      || sheets[0]
    if (chosen) {
      return new Response(sheetToCsv(chosen), { headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=${safeName}-${chosen.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "sheet"}.csv`,
        "cache-control": "no-store",
      } })
    }
  }

  if (!templateCode) {
    const documents = await listWorkspaceDocuments(workspaceId, { fileId, status: statusFilter })
    const rows = documents.map(documentDataForExport)
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`${keys.map(csvCell).join(",")}\n`)); for (const row of rows) controller.enqueue(new TextEncoder().encode(`${keys.map((key) => csvCell(row[key as keyof typeof row])).join(",")}\n`)); controller.close() } })
    return new Response(stream, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=${safeName}-export.csv`, "cache-control": "no-store" } })
  }

  // Worksheet codes are unique per file, so this lookup has to be scoped to the file.
  const templates = await getFileTemplates(workspaceId, fileId)
  const template = templates.find((t) => t.code === templateCode)
  if (!template?.versions[0]) return new Response("Template not found", { status: 404 })
  const fields = parseTemplateFields(template.versions[0].fields)
  const documents = await listWorkspaceDocuments(workspaceId, { fileId, templateId: template.id, status: statusFilter })

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook()
    const docCols = exportColumns(fields, "documents")
    const docLabels = exportColumnLabels(fields, "documents")
    const docSheet = workbook.addWorksheet("Documents")
    docSheet.columns = docCols.map((key) => ({ header: docLabels[key] || key, key, width: 18 }))
    for (const doc of documents) docSheet.addRow(documentExportRow(doc, fields))

    const hasLineItems = fields.some((f) => f.type === "array" && f.itemFields?.length)
    if (hasLineItems) {
      const itemCols = exportColumns(fields, "line_items")
      const itemLabels = exportColumnLabels(fields, "line_items")
      const itemSheet = workbook.addWorksheet("Line items")
      itemSheet.columns = itemCols.map((key) => ({ header: itemLabels[key] || key, key, width: 18 }))
      for (const doc of documents) {
        for (const row of lineItemExportRows(doc, fields)) itemSheet.addRow(row)
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer as ArrayBuffer, { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename=${safeName}-${templateCode}-export.xlsx`,
      "cache-control": "no-store",
    } })
  }

  const cols = exportColumns(fields, sheet as "documents" | "line_items")
  const labels = exportColumnLabels(fields, sheet as "documents" | "line_items")
  const exportRows = sheet === "line_items"
    ? documents.flatMap((doc) => lineItemExportRows(doc, fields))
    : documents.map((doc) => documentExportRow(doc, fields))

  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`${cols.map((key) => csvCell(labels[key] || key)).join(",")}\n`))
    for (const row of exportRows) controller.enqueue(new TextEncoder().encode(`${cols.map((key) => csvCell(row[key])).join(",")}\n`))
    controller.close()
  } })
  return new Response(stream, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=${safeName}-${templateCode}-${sheet}-export.csv`, "cache-control": "no-store" } })
}
