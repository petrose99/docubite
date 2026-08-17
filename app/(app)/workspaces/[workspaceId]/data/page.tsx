import { DataBrowser, type DataColumn, type DataNumberField, type DataRow } from "@/components/data/data-browser"
import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields, type DocumentFieldDefinition } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { listDataFilterOptions, listDocumentData, type DataDocumentSort } from "@/models/document-values"
import { requireWorkspaceRole } from "@/models/workspaces"

const asString = (classification: unknown, key: "docType" | "entity"): string => {
  if (classification && typeof classification === "object" && !Array.isArray(classification)) {
    const value = (classification as Record<string, unknown>)[key]
    return typeof value === "string" ? value : ""
  }
  return ""
}

/** The queryable extracted-data browser: every document's values across the whole workspace, with
 * search, filters, aggregates, CSV export and a cross-document AI assistant. Sibling of files/ so
 * it gets the app shell (sidebar + full width) rather than the narrow reading column. */
export default async function DataPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ q?: string; template?: string; file?: string; doctype?: string; status?: string; from?: string; to?: string; sort?: string; dir?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const filters = {
    q: query.q?.trim() || "",
    template: query.template || "",
    file: query.file || "",
    doctype: query.doctype || "",
    status: query.status || "",
    from: query.from || "",
    to: query.to || "",
    sort: query.sort === "filename" || query.sort === "status" ? query.sort : "receivedAt",
    dir: query.dir === "asc" ? ("asc" as const) : ("desc" as const),
  }

  const [documents, options, workspace] = await Promise.all([
    listDocumentData(workspaceId, {
      query: filters.q || undefined,
      templateId: filters.template || undefined,
      fileId: filters.file || undefined,
      docType: filters.doctype || undefined,
      status: filters.status || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }, { sort: filters.sort as DataDocumentSort, dir: filters.dir }),
    listDataFilterOptions(workspaceId),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } }),
  ])

  // Dynamic columns + number fields come from the selected worksheet's field set.
  let columns: DataColumn[] = []
  let numberFields: DataNumberField[] = []
  if (filters.template) {
    const selected = options.templates.find((template) => template.id === filters.template)
    if (selected) {
      let fields: DocumentFieldDefinition[] = []
      try {
        fields = parseTemplateFields(selected.fields)
      } catch {
        fields = []
      }
      columns = fields.map((field) => ({ key: field.key, label: field.label, isArray: field.type === "array" }))
      numberFields = fields.filter((field) => field.type === "number").map((field) => ({ key: field.key, label: field.label }))
    }
  }

  const rows: DataRow[] = documents.map((document) => ({
    id: document.id,
    filename: document.filename,
    status: document.status,
    receivedAt: document.receivedAt.toISOString(),
    docType: asString(document.classification, "docType"),
    entity: asString(document.classification, "entity"),
    fileName: document.file?.name ?? "",
    worksheetName: document.template?.name ?? null,
    data: ((document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}),
  }))

  return <main className="flex min-h-0 flex-1 flex-col">
    <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
      <h1 className="text-xl font-bold text-stone-900">Data</h1>
      <p className="text-sm text-stone-500">Search and report on every value extracted across this workspace.</p>
    </header>
    <DataBrowser
      workspaceId={workspaceId}
      filters={filters}
      rows={rows}
      options={{
        templates: options.templates.map((template) => ({ id: template.id, name: template.name, fileName: template.fileName })),
        files: options.files,
        docTypes: options.docTypes,
      }}
      columns={columns}
      numberFields={numberFields}
      aiEnabled={workspace?.aiEnabled ?? false} />
  </main>
}
