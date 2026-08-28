import { AutomationRuleForm } from "@/components/workspace/automation-rule-form"
import { DocumentPreview } from "@/components/documents/document-preview"
import { ReviewTaskDetail } from "@/components/workspace/review-task-detail"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { getReviewTask } from "@/models/review-tasks"
import { getWorkspaceMembers, requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** The task detail beside the existing document view (WP10): the source file on one side, the
 * extracted fields and the review controls on the other — reusing /api/documents/[id]/source,
 * the same authorised-through-the-file route the sheet's own preview and the shared-file grid
 * already serve source bytes through, rather than a new one. */
export default async function ReviewTaskDetailPage({ params }: { params: Promise<{ workspaceId: string; taskId: string }> }) {
  const { workspaceId, taskId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const capabilities = await getWorkspaceCapabilities(workspaceId)
  if (!capabilities.has("review-queue")) notFound()

  const task = await getReviewTask(workspaceId, taskId)
  if (!task) notFound()

  const fields = parseTemplateFields(task.document.fieldSnapshot)
  const values = (task.document.reviewedData ?? task.document.rawExtraction ?? {}) as Record<string, unknown>
  const members = await getWorkspaceMembers(workspaceId)
  const checkResults = await prisma.documentCheckResult.findMany({ where: { workspaceId, documentId: task.document.id }, orderBy: { checkCode: "asc" } })
  const supplierValue = values.vendor ?? values.merchant
  const supplier = typeof supplierValue === "string" ? supplierValue.trim() : ""
  const canCreateRule = capabilities.has("supplier-rules") && membership.role === "owner" && supplier.length > 0

  return <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">{task.document.filename}</h1>
        <p className="mt-1 text-sm text-stone-500">{task.detail || "No additional detail was given when this task was created."}</p>
      </header>

      {task.document.storageKey
        ? <DocumentPreview src={`/api/documents/${task.document.id}/source`} filename={task.document.filename} mimeType={task.document.mimeType} className="h-[70vh] rounded border" />
        : <p className="rounded border border-dashed p-6 text-center text-sm text-stone-400">Source not available</p>}
    </div>

    <div className="space-y-4">
      <ReviewTaskDetail
        workspaceId={workspaceId}
        taskId={task.id}
        status={task.status}
        assigneeId={task.assigneeId}
        members={members.map((member) => ({ id: member.userId, name: member.user.name }))} />

      {checkResults.length > 0 && <div className="rounded border p-4">
        <h2 className="text-sm font-bold text-stone-900">Deterministic checks</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {checkResults.map((check) => (
            <li key={check.id} className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${check.status === "fail" ? "bg-red-100 text-red-700" : check.status === "warn" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{check.status}</span>
              <span className="text-stone-600">{check.message}</span>
            </li>
          ))}
        </ul>
      </div>}

      <div className="rounded border p-4">
        <h2 className="text-sm font-bold text-stone-900">Extracted fields</h2>
        <dl className="mt-2 space-y-1.5 text-sm">
          {fields.filter((field) => field.type !== "array").map((field) => (
            <div key={field.key} className="flex justify-between gap-3">
              <dt className="text-stone-500">{field.label}</dt>
              <dd className="text-right font-medium text-stone-900">{formatValue(values[field.key])}</dd>
            </div>
          ))}
        </dl>
      </div>

      {canCreateRule && <details className="rounded border p-4">
        <summary className="cursor-pointer text-sm font-bold text-stone-900">Create a rule from this document</summary>
        <p className="mt-1 text-xs text-stone-500">Matches this supplier automatically on future documents.</p>
        <div className="mt-3">
          <AutomationRuleForm workspaceId={workspaceId} defaultSupplier={supplier} />
        </div>
      </details>}
    </div>
  </main>
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
