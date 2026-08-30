import { WorkspaceAiToggle } from "@/components/workspace/ai-toggle"
import { WorkspaceDangerZone } from "@/components/workspace/danger-zone"
import { InvitePanel } from "@/components/workspace/invite-panel"
import { MembersTable } from "@/components/workspace/members-table"
import { TeamWorkspaceForm } from "@/components/workspace/team-workspace-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceMembers, listWorkspaceInvitations, requireWorkspaceRole } from "@/models/workspaces"

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const members = await getWorkspaceMembers(workspaceId)
  const owner = membership.role === "owner"
  const invitations = owner ? await listWorkspaceInvitations(workspaceId) : []

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Workspace</h1>
      <p className="mt-1 text-muted-foreground">{membership.workspace.name} · {membership.workspace.kind === "team" ? "Team workspace" : "Personal workspace"}</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>Uploaded sources and reviewed data are stored for this workspace&apos;s members.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {owner ? <WorkspaceAiToggle workspaceId={workspaceId} enabled={membership.workspace.aiEnabled} /> : <p className="text-sm">AI extraction is {membership.workspace.aiEnabled ? "enabled" : "disabled"} by the workspace owner.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Owners manage access. Members can upload, review, search, and export documents. {members.length} {members.length === 1 ? "member" : "members"}.</CardDescription>
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

    {owner && <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>Invitations expire seven days after they are sent. Resending issues a fresh link and invalidates the previous one.</CardDescription>
      </CardHeader>
      <CardContent>
        <InvitePanel workspaceId={workspaceId} invitations={invitations.map((invitation) => ({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() }))} />
      </CardContent>
    </Card>}

    <Card>
      <CardHeader>
        <CardTitle>Create a team workspace</CardTitle>
        <CardDescription>A separate workspace with its own files, members, and usage.</CardDescription>
      </CardHeader>
      <CardContent><TeamWorkspaceForm /></CardContent>
    </Card>

    <WorkspaceDangerZone workspaceId={workspaceId} workspaceName={membership.workspace.name} workspaceKind={membership.workspace.kind} viewerRole={membership.role} />
  </main>
}
