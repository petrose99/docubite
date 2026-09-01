import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getCurrentUser } from "@/lib/auth"
import { listWorkspaceAuditEventActors, listWorkspaceAuditEventTypes, listWorkspaceAuditEvents } from "@/models/audit-events"
import { requireWorkspaceRole } from "@/models/workspaces"
import { Download } from "lucide-react"

/** The workspace's activity feed: every DocumentAuditEvent (models/audit-events.ts), newest
 * first. Available to every member, not gated behind a plan or a config flag — unlike
 * Integrations this is pure read-only visibility into what already happened, which is exactly
 * the kind of thing a regulated buyer's procurement checklist asks for.
 *
 * Filters are a plain GET form, not client state: the export route needs the exact same query
 * params to produce a matching CSV, so the page's URL is the one source of truth for "what is
 * currently filtered" rather than duplicating it in both a client component and the export link. */
export default async function ActivityPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ type?: string; actor?: string; from?: string; to?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const type = query.type || undefined
  const actorId = query.actor || undefined
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined

  const [events, types, actors] = await Promise.all([
    listWorkspaceAuditEvents(workspaceId, 200, { type, actorId, from, to }),
    listWorkspaceAuditEventTypes(workspaceId),
    listWorkspaceAuditEventActors(workspaceId),
  ])

  const hasFilters = !!(type || actorId || query.from || query.to)
  const exportHref = `/workspaces/${workspaceId}/settings/activity/export${hasFilters ? `?${new URLSearchParams({
    ...(type ? { type } : {}), ...(actorId ? { actor: actorId } : {}), ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}),
  }).toString()}` : ""}`

  return <main className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">Activity</h1>
        <p className="mt-1 text-muted-foreground">Every change made to documents in this workspace, who made it, and when.</p>
      </div>
      <Button asChild variant="outline">
        <a href={exportHref}><Download className="mr-2 h-4 w-4" />Export CSV</a>
      </Button>
    </header>

    <Card>
      <CardContent className="pt-6">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="type">Event type</Label>
            <NativeSelect id="type" name="type" defaultValue={type ?? ""} className="w-48">
              <option value="">All events</option>
              {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="actor">Actor</Label>
            <NativeSelect id="actor" name="actor" defaultValue={actorId ?? ""} className="w-48">
              <option value="">Everyone</option>
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={query.from ?? ""} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={query.to ?? ""} className="w-40" />
          </div>
          <Button type="submit">Filter</Button>
          {hasFilters && <Button asChild variant="ghost"><a href={`/workspaces/${workspaceId}/settings/activity`}>Clear</a></Button>}
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>{hasFilters ? `${events.length} matching event${events.length === 1 ? "" : "s"}.` : `The last ${events.length} events.`}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Outcome</th>
                <th className="py-2 pr-3">Document</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">From</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{event.label}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{event.outcome !== "success" ? <span className="font-medium text-destructive">{event.outcome}</span> : "success"}</td>
                  <td className="py-2 pr-3 truncate max-w-[240px] text-muted-foreground" title={event.documentFilename ?? undefined}>{event.documentFilename ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{event.actorName ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{event.sourceIp ?? "—"}</td>
                  <td className="py-2 text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!events.length && (
                <tr><td colSpan={6} className="py-3 text-muted-foreground">{hasFilters ? "No events match these filters." : "No activity yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </main>
}
