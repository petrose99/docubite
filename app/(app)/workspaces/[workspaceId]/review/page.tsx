import { ReviewQueueTable } from "@/components/workspace/review-queue-table"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listReviewTasks, parseReviewTaskStatus, type ReviewTaskStatus } from "@/models/review-tasks"
import { requireWorkspaceRole } from "@/models/workspaces"
import { getCurrentUser } from "@/lib/auth"
import { notFound } from "next/navigation"
import Link from "next/link"

export const dynamic = "force-dynamic"

const STATUS_TABS: { value: ReviewTaskStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
]

/** The accounting review queue (WP10) — finance-industry only, matching the sidebar entry that
 * links here. Table + bulk actions first, per the roadmap; a detail page per task follows this
 * one. Nothing populates this automatically yet — WP11 (rules) and WP12 (checks) are what will —
 * so today every row here was created manually. */
export default async function ReviewQueuePage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { workspaceId } = await params
  const { status: statusParam } = await searchParams
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  if (!(await getWorkspaceCapabilities(workspaceId)).has("review-queue")) notFound()

  const status = statusParam && statusParam !== "all" ? parseReviewTaskStatus(statusParam) ?? undefined : undefined
  const tasks = await listReviewTasks(workspaceId, status ? { status } : {})

  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
    <header>
      <h1 className="text-3xl font-bold text-stone-900">Review queue</h1>
      <p className="mt-1 text-sm text-stone-500">Documents that need a person to look at them before they&apos;re trusted.</p>
    </header>

    <nav className="flex gap-1 border-b">
      {STATUS_TABS.map((tab) => {
        const active = (statusParam ?? "open") === tab.value
        return <Link key={tab.value} href={tab.value === "open" ? `/workspaces/${workspaceId}/review` : `/workspaces/${workspaceId}/review?status=${tab.value}`}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
          {tab.label}
        </Link>
      })}
    </nav>

    <ReviewQueueTable
      workspaceId={workspaceId}
      tasks={tasks.map((task) => ({
        id: task.id, status: task.status, reason: task.reason, priority: task.priority,
        dueAt: task.dueAt?.toISOString() ?? null,
        document: { id: task.document.id, filename: task.document.filename, templateName: task.document.template?.name ?? null },
        assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      }))} />
  </main>
}
