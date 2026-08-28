import { WorkspaceAiToggle } from "@/components/workspace/ai-toggle"
import { WorkspaceDangerZone } from "@/components/workspace/danger-zone"
import { WorkspaceHipaaModeToggle } from "@/components/workspace/hipaa-mode-toggle"
import { WorkspaceIndustryToggle } from "@/components/workspace/industry-toggle"
import { InvitePanel } from "@/components/workspace/invite-panel"
import { parseIndustry } from "@/types/industry"
import { MembersTable } from "@/components/workspace/members-table"
import { TeamWorkspaceForm } from "@/components/workspace/team-workspace-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspacePlan } from "@/lib/plans"
import { getWorkspaceMembers, listWorkspaceInvitations, requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const members = await getWorkspaceMembers(workspaceId)
  const owner = membership.role === "owner"
  const plan = getWorkspacePlan(membership.workspace.subscription?.planCode || "starter")
  // Seats gate *inviting*, not seeing. The roster and the danger zone are always rendered: the
  // members list used to sit behind this flag too, which on a one-seat plan also hid the only
  // place a member could leave a workspace they had been invited into.
  const seatsAvailable = plan.limits.members < 0 || plan.limits.members > 1
  const invitations = owner && seatsAvailable ? await listWorkspaceInvitations(workspaceId) : []

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Workspace</h1>
      <p className="mt-1 text-muted-foreground">{membership.workspace.name} · {membership.workspace.kind === "team" ? "Team workspace" : "Personal workspace"} · {plan.name} plan</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>Uploaded sources and reviewed data are stored for this workspace&apos;s members.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {owner ? <WorkspaceAiToggle workspaceId={workspaceId} enabled={membership.workspace.aiEnabled} /> : <p className="text-sm">AI extraction is {membership.workspace.aiEnabled ? "enabled" : "disabled"} by the workspace owner.</p>}
        {owner
          ? <WorkspaceIndustryToggle workspaceId={workspaceId} mode={parseIndustry(membership.workspace.industry) || "general"} />
          : <p className="text-sm">This workspace is set up for {membership.workspace.industry} by the workspace owner.</p>}
        {owner
          ? <WorkspaceHipaaModeToggle workspaceId={workspaceId} enabled={membership.workspace.hipaaMode} />
          : <p className="text-sm">HIPAA mode is {membership.workspace.hipaaMode ? "enabled" : "disabled"} by the workspace owner.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Owners manage access and billing. Members can upload, review, search, and export documents. {plan.limits.members < 0 ? "Unlimited seats" : `${members.length} of ${plan.limits.members} seats used`}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MembersTable
          workspaceId={workspaceId}
          workspaceKind={membership.workspace.kind}
          viewerId={user.id}
          viewerRole={membership.role}
          members={members.map((member) => ({ userId: member.userId, name: member.user.name, email: member.user.email, role: member.role }))} />
      </CardContent>
    </Card>

    {owner && seatsAvailable && <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>Invitations expire seven days after they are sent. Resending issues a fresh link and invalidates the previous one.</CardDescription>
      </CardHeader>
      <CardContent>
        <InvitePanel workspaceId={workspaceId} invitations={invitations.map((invitation) => ({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() }))} />
      </CardContent>
    </Card>}

    {seatsAvailable
      ? <Card>
          <CardHeader>
            <CardTitle>Create a team workspace</CardTitle>
            <CardDescription>A separate workspace with its own files, members, and usage.</CardDescription>
          </CardHeader>
          <CardContent><TeamWorkspaceForm /></CardContent>
        </Card>
      : <Card>
          <CardHeader>
            <CardTitle>Team workspace</CardTitle>
            <CardDescription>Your current plan only supports one user. Please upgrade to a Pro or higher plan to access additional seats and create your workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/workspaces/${workspaceId}/settings/billing`} className="inline-flex items-center rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Upgrade plan</Link>
          </CardContent>
        </Card>}

    <WorkspaceDangerZone workspaceId={workspaceId} workspaceName={membership.workspace.name} workspaceKind={membership.workspace.kind} viewerRole={membership.role} />
  </main>
}
