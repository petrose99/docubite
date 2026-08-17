import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields, type DocumentFieldDefinition } from "@/lib/document-templates"
import { listDocumentData, type DataFilters } from "@/models/document-values"
import { prisma } from "@/lib/db"
import { requireWorkspaceRole } from "@/models/workspaces"

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '""'
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return `"${JSON.stringify(value).replaceAll('"', '""')}"`
  return `"${String(value).replaceAll('"', '""')}"`
}

const docType = (classification: unknown) => {
  if (classification && typeof classification === "object" && !Array.isArray(classification)) {
    const value = (classification as Record<string, unknown>).docType
    return typeof value === "string" ? value : ""
  }
  return ""
}

const entity = (classification: unknown) => {
  if (classification && typeof classification === "object" && !Array.isArray(classification)) {
    const value = (classification as Record<string, unknown>).entity
    return typeof value === "string" ? value : ""
  }
  return ""
}

/** CSV export of the /data browser, honouring the current query string. Columns are the fixed
 * metadata plus, when a template (worksheet) is selected, that template's fields; otherwise the
 * union of keys across the matched documents' extracted data. Capped at 1000 rows to match the
 * page's "first 1000" ceiling. */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const url = new URL(request.url)
  const filters: DataFilters = {
    query: url.searchParams.get("q") || undefined,
    templateId: url.searchParams.get("template") || undefined,
    fileId: url.searchParams.get("file") || undefined,
    docType: url.searchParams.get("doctype") || undefined,
    status: url.searchParams.get("status") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  }
  const sort = url.searchParams.get("sort")
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc"
  const documents = await listDocumentData(workspaceId, filters, {
    take: 1000,
    sort: sort === "filename" || sort === "status" ? sort : "receivedAt",
    dir,
  })

  const META_COLUMNS = ["document", "file", "type", "entity", "received_at", "status"] as const

  let fields: DocumentFieldDefinition[] | null = null
  if (filters.templateId) {
    const template = await prisma.documentTemplate.findFirst({
      where: { id: filters.templateId, workspaceId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    })
    if (template?.versions[0]) {
      try {
        fields = parseTemplateFields(template.versions[0].fields)
      } catch {
        fields = null
      }
    }
  }

  const dataOf = (document: (typeof documents)[number]) =>
    ((document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {})

  // Data columns: the selected template's fields, else the union of extracted keys across matches.
  const dataColumns: Array<{ key: string; label: string; isArray: boolean }> = fields
    ? fields.map((field) => ({ key: field.key, label: field.label, isArray: field.type === "array" }))
    : [...new Set(documents.flatMap((document) => Object.keys(dataOf(document))))].map((key) => ({ key, label: key, isArray: false }))

  const metaValue = (document: (typeof documents)[number], key: (typeof META_COLUMNS)[number]) => {
    switch (key) {
      case "document": return document.filename
      case "file": return document.file?.name ?? ""
      case "type": return docType(document.classification)
      case "entity": return entity(document.classification)
      case "received_at": return document.receivedAt.toISOString()
      case "status": return document.status
    }
  }

  const cellFor = (document: (typeof documents)[number], column: { key: string; isArray: boolean }) => {
    const data = dataOf(document)
    const value = data[column.key]
    if (column.isArray || Array.isArray(value)) {
      const items = Array.isArray(value) ? value : []
      return `${items.length} item${items.length === 1 ? "" : "s"}`
    }
    return value ?? ""
  }

  const headerLabels: Record<string, string> = { document: "Document", file: "File", type: "Type", entity: "Entity", received_at: "Received at", status: "Status" }
  const headers = [...META_COLUMNS.map((key) => headerLabels[key]), ...dataColumns.map((column) => column.label)]

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(`${headers.map(csvCell).join(",")}\n`))
      for (const document of documents) {
        const cells = [
          ...META_COLUMNS.map((key) => csvCell(metaValue(document, key))),
          ...dataColumns.map((column) => csvCell(cellFor(document, column))),
        ]
        controller.enqueue(encoder.encode(`${cells.join(",")}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=data-export.csv`,
      "cache-control": "no-store",
    },
  })
}
