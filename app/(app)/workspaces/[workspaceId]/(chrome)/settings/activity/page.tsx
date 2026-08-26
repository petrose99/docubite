import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { listWorkspaceAuditEvents } from "@/models/audit-events"
import { requireWorkspaceRole } from "@/models/workspaces"

/** The workspace's activity feed: every DocumentAuditEvent (models/audit-events.ts), newest
 * first. Available to every member, not gated behind a plan or a config flag — unlike
 * Integrations this is pure read-only visibility into what already happened, which is exactly
 * the kind of thing a regulated buyer's procurement checklist asks for. */
export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  const events = await listWorkspaceAuditEvents(workspaceId, 100)

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Activity</h1>
      <p className="mt-1 text-muted-foreground">Every change made to documents in this workspace, who made it, and when.</p>
    </header>
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The last {events.length} events.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Document</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{event.label}</td>
                  <td className="py-2 pr-3 truncate max-w-[240px] text-muted-foreground" title={event.documentFilename ?? undefined}>{event.documentFilename ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{event.actorName ?? "—"}</td>
                  <td className="py-2 text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!events.length && (
                <tr><td colSpan={4} className="py-3 text-muted-foreground">No activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </main>
}
