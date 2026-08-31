import { ExpenseClaimForm } from "@/components/workspace/expense-claim-form"
import { ExpenseClaimRow } from "@/components/workspace/expense-claim-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { canDecideStage, findCurrentStage } from "@/lib/approvals/engine"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listApprovalWorkflows } from "@/models/approval-workflows"
import { listExpenseClaims, listUnclaimedExpenseReceiptDocuments } from "@/models/expense-claims"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

function receiptSummary(document: { reviewedData: unknown }): { merchant: string; total: number | null } {
  const values = (document.reviewedData ?? {}) as Record<string, unknown>
  const merchant = typeof values.merchant === "string" ? values.merchant : "Untitled receipt"
  const total = typeof values.total === "number" ? values.total : null
  return { merchant, total }
}

/** Expense claims (Dext-parity Phase 3 WP3.3): submit a group of expense_receipt documents as one
 * claim, optionally routed through an ApprovalWorkflow (Phase 3 WP3.1/3.2) the same way a
 * ReviewTask can be. Everyone with the module can see every claim (approving someone else's claim
 * requires seeing it), but only the submitter or an owner can create/submit/delete their own. */
export default async function ExpenseClaimsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!(await getWorkspaceCapabilities(workspaceId)).has("expense-approvals")) notFound()

  const [claims, unclaimedDocuments, workflows] = await Promise.all([
    listExpenseClaims(workspaceId),
    listUnclaimedExpenseReceiptDocuments(workspaceId),
    listApprovalWorkflows(workspaceId, { activeOnly: true }),
  ])
  const actorRole = membership.role === "owner" ? "owner" : "member"
  const availableWorkflows = workflows.map((workflow) => ({ id: workflow.id, name: workflow.name, stageCount: workflow.stages.length }))
  const unclaimedReceipts = unclaimedDocuments.map((document) => ({ id: document.id, filename: document.filename, ...receiptSummary(document) }))

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Expense claims</h1>
      <p className="mt-1 text-muted-foreground">Group receipts into a claim, then submit it for a decision — plain or through a multi-stage approval workflow.</p>
    </header>

    <Card>
      <CardHeader><CardTitle>New claim</CardTitle></CardHeader>
      <CardContent>
        {unclaimedDocuments.length
          ? <ExpenseClaimForm workspaceId={workspaceId} receipts={unclaimedDocuments.map((document) => ({ id: document.id, filename: document.filename, ...receiptSummary(document) }))} />
          : <p className="text-sm text-slate-500">No unclaimed expense receipts. Upload one as an &ldquo;Expense receipt&rdquo; document first.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Claims</CardTitle>
        <CardDescription>{claims.length} claim{claims.length === 1 ? "" : "s"}.</CardDescription>
      </CardHeader>
      <CardContent>
        {!claims.length
          ? <p className="text-sm text-slate-500">No claims yet.</p>
          : <ul className="space-y-3">
              {claims.map((claim) => {
                const currentStage = claim.workflow && claim.currentStageIndex !== null ? findCurrentStage(claim.workflow.stages, claim.currentStageIndex) : null
                const canDecideCurrentStage = currentStage ? canDecideStage({ stage: currentStage, actorRole }) : actorRole === "owner"
                return <ExpenseClaimRow
                  key={claim.id}
                  workspaceId={workspaceId}
                  currentUserId={user.id}
                  isOwner={actorRole === "owner"}
                  canDecideCurrentStage={canDecideCurrentStage}
                  availableWorkflows={availableWorkflows}
                  unclaimedReceipts={unclaimedReceipts}
                  claim={{
                    id: claim.id, title: claim.title, status: claim.status, total: claim.total, currencyCode: claim.currencyCode,
                    submitter: claim.submitter ? { id: claim.submitter.id, name: claim.submitter.name } : null,
                    items: claim.items.map((item) => ({ id: item.id, ...receiptSummary(item.document) })),
                    workflow: claim.workflow && claim.currentStageIndex !== null ? {
                      name: claim.workflow.name, currentStageIndex: claim.currentStageIndex,
                      stages: claim.workflow.stages.map((stage) => ({ stageIndex: stage.stageIndex, name: stage.name, requireOwner: stage.requireOwner })),
                    } : null,
                  }} />
              })}
            </ul>}
      </CardContent>
    </Card>
  </main>
}
