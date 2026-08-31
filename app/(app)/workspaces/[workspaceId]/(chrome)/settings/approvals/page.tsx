import { ApprovalWorkflowForm } from "@/components/workspace/approval-workflow-form"
import { ApprovalWorkflowRowControls } from "@/components/workspace/approval-workflow-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listApprovalWorkflows } from "@/models/approval-workflows"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** Approval-workflow settings (Dext-parity Phase 3 WP3.2): build/edit the named stage sequences a
 * ReviewTask can be routed through instead of the plain single-decision default. Same owner-only-
 * to-mutate, everyone-can-see bar as the supplier-rules settings page — a workflow is workspace
 * policy, not a per-document choice. */
export default async function ApprovalWorkflowsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!(await getWorkspaceCapabilities(workspaceId)).has("approval-workflows")) notFound()

  const workflows = await listApprovalWorkflows(workspaceId)
  const owner = membership.role === "owner"

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Approval workflows</h1>
      <p className="mt-1 text-muted-foreground">Route a review task through named stages before it counts as approved. A stage can be left open to any workspace member, or restricted to an owner.</p>
    </header>

    {owner && <Card>
      <CardHeader><CardTitle>Add a workflow</CardTitle></CardHeader>
      <CardContent><ApprovalWorkflowForm workspaceId={workspaceId} /></CardContent>
    </Card>}

    <Card>
      <CardHeader>
        <CardTitle>Workflows</CardTitle>
        <CardDescription>{workflows.length} workflow{workflows.length === 1 ? "" : "s"}.</CardDescription>
      </CardHeader>
      <CardContent>
        {!workflows.length
          ? <p className="text-sm text-slate-500">No workflows yet. Review tasks use the plain open/in review/approved/rejected flow until one is started on them.</p>
          : <ul className="space-y-3">
              {workflows.map((workflow) => (
                <li key={workflow.id} className="rounded border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">{workflow.name}</span>
                    {owner
                      ? <ApprovalWorkflowRowControls workspaceId={workspaceId} workflowId={workflow.id} workflowName={workflow.name} active={workflow.active} />
                      : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{workflow.active ? "Active" : "Inactive"}</span>}
                  </div>
                  <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                    {workflow.stages.map((stage, index) => (
                      <li key={stage.id} className="flex items-center gap-1.5">
                        {index > 0 && <span className="text-slate-300">→</span>}
                        <span className="rounded-full border px-2 py-0.5">{stage.name}{stage.requireOwner ? " (owner)" : ""}</span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>}
      </CardContent>
    </Card>
  </main>
}
