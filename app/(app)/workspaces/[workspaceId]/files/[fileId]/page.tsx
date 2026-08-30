import { FileHeader } from "@/components/files/file-header"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listWorkspaceDocuments } from "@/models/documents"
import { getFileTemplates, getWorkspaceFile } from "@/models/files"
import { listOpenReviewTasksForFile } from "@/models/review-tasks"
import { requireWorkspaceRole } from "@/models/workspaces"
import { ClipboardCheck, Download, FileText, Table2, Upload } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

const STATUS_LABEL: Record<string, string> = {
  received: "Received", queued: "Queued", processing: "Processing", extracted: "Extracted",
  reviewed: "Reviewed", failed: "Failed", ready: "Ready",
}

/** The stop between Files and the full-bleed grid: what's in this file (documents, their review
 * status, worksheets) and where to go next (open the spreadsheet, upload more, export). The
 * sidebar stays visible here — it only hides on the sheet route itself. */
export default async function FileHubPage({ params }: { params: Promise<{ workspaceId: string; fileId: string }> }) {
  const { workspaceId, fileId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) notFound()

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  const hasReviewQueue = capabilities.has("review-queue")

  const [documents, templates, reviewTasks] = await Promise.all([
    listWorkspaceDocuments(workspaceId, { fileId }),
    getFileTemplates(workspaceId, fileId),
    hasReviewQueue ? listOpenReviewTasksForFile(workspaceId, fileId) : Promise.resolve([]),
  ])

  const base = `/workspaces/${workspaceId}/files/${fileId}`

  return <div className="mx-auto w-full max-w-5xl">
    <FileHeader workspaceId={workspaceId} fileId={fileId} name={file.name} linkAccess={file.linkAccess} />

    <div className="space-y-6 p-6">
      <div className="flex flex-wrap gap-3">
        <Link href={`${base}/sheet`} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
          <Table2 className="h-4 w-4" />Open spreadsheet
        </Link>
        <Link href={`${base}/sheet?extract=1`} className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
          <Upload className="h-4 w-4" />Upload documents
        </Link>
        <Link href={`${base}/export?format=xlsx`} className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
          <Download className="h-4 w-4" />Export xlsx
        </Link>
        <Link href={`${base}/export?format=csv`} className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
          <Download className="h-4 w-4" />Export csv
        </Link>
      </div>

      {hasReviewQueue && reviewTasks.length > 0 && <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Open review tasks</h2>
        <ul className="divide-y rounded border bg-white">
          {reviewTasks.map((task: Awaited<ReturnType<typeof listOpenReviewTasksForFile>>[number]) => <li key={task.id}>
            <Link href={`/workspaces/${workspaceId}/review/${task.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
              <ClipboardCheck className="h-4 w-4 shrink-0 text-emerald-700" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{task.document.filename}</span>
              <span className="shrink-0 text-xs text-stone-400">{task.status === "in_review" ? "In review" : "Open"}</span>
            </Link>
          </li>)}
        </ul>
      </section>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Documents ({documents.length})</h2>
        {documents.length
          ? <ul className="divide-y rounded border bg-white">
              {documents.map((document: Awaited<ReturnType<typeof listWorkspaceDocuments>>[number]) => <li key={document.id}>
                <Link href={`/workspaces/${workspaceId}/documents/${document.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                  <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{document.filename}</span>
                  {document.template && <span className="shrink-0 text-xs text-stone-400">{document.template.name}</span>}
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{STATUS_LABEL[document.status] ?? document.status}</span>
                </Link>
              </li>)}
            </ul>
          : <p className="rounded border border-dashed p-6 text-center text-sm text-stone-400">No documents yet — upload some to get started.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Worksheets</h2>
        <ul className="divide-y rounded border bg-white">
          {templates.map((template: Awaited<ReturnType<typeof getFileTemplates>>[number]) => <li key={template.id}>
            <Link href={`/workspaces/${workspaceId}/settings/templates`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
              <Table2 className="h-4 w-4 shrink-0 text-stone-400" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{template.name}</span>
            </Link>
          </li>)}
        </ul>
      </section>
    </div>
  </div>
}
