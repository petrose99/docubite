import { AutomationRuleActiveToggle } from "@/components/workspace/automation-rule-row"
import { AutomationRuleForm } from "@/components/workspace/automation-rule-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { resolveAccountOptions } from "@/lib/automation/account-options"
import type { RuleActions, RuleMatcher } from "@/lib/automation/rules"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listAccountingEntities } from "@/models/accounting-entities"
import { listAutomationRules } from "@/models/automation-rules"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** Supplier automation rules (WP11): matcher + coding + hit stats. Accounting-mode only, and only
 * the owner can create or toggle one (automation-actions.ts) — every rule change is an audit
 * event, the same bar as the workspace's other owner-only settings. */
export default async function AutomationRulesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!(await getWorkspaceCapabilities(workspaceId)).has("supplier-rules")) notFound()

  const [rules, accountingEntities] = await Promise.all([
    listAutomationRules(workspaceId),
    listAccountingEntities(workspaceId, "account"),
  ])
  const accountOptions = resolveAccountOptions(accountingEntities)
  const owner = membership.role === "owner"

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Supplier rules</h1>
      <p className="mt-1 text-muted-foreground">When a document&apos;s supplier matches, its coding is applied automatically. A rule that requires review still gets applied — it just also lands in the review queue.</p>
    </header>

    {owner && <Card>
      <CardHeader><CardTitle>Add a rule</CardTitle></CardHeader>
      <CardContent><AutomationRuleForm workspaceId={workspaceId} accountOptions={accountOptions} /></CardContent>
    </Card>}

    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
        <CardDescription>{rules.length} rule{rules.length === 1 ? "" : "s"}, most-used first.</CardDescription>
      </CardHeader>
      <CardContent>
        {!rules.length
          ? <p className="text-sm text-slate-500">No rules yet.</p>
          : <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Matches</th>
                  <th className="py-2 pr-4 font-medium">Assigns</th>
                  <th className="py-2 pr-4 font-medium">Hits</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const matcher = rule.matcher as unknown as RuleMatcher
                  const actions = rule.actions as unknown as RuleActions
                  return <tr key={rule.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{rule.name}</td>
                    <td className="py-2 pr-4 text-slate-600">Supplier {matcher.type === "exact" ? "is" : "contains"} &ldquo;{matcher.value}&rdquo;</td>
                    <td className="py-2 pr-4 text-slate-600">{Object.entries(actions.codingData || {}).map(([key, value]) => `${key}: ${value}`).join(", ")}</td>
                    <td className="py-2 pr-4 text-slate-600">{rule.hitCount}</td>
                    <td className="py-2">{owner ? <AutomationRuleActiveToggle workspaceId={workspaceId} ruleId={rule.id} active={rule.isActive} /> : <span className="text-xs text-slate-500">{rule.isActive ? "Active" : "Inactive"}</span>}</td>
                  </tr>
                })}
              </tbody>
            </table>}
      </CardContent>
    </Card>
  </main>
}
