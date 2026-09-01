import { recordDocumentAudit } from "@/lib/audit"
import { getCurrentUser } from "@/lib/auth"
import { listWorkspaceAuditEventsForExport } from "@/models/audit-events"
import { requireWorkspaceRole } from "@/models/workspaces"

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '""'
  if (typeof value === "object") return `"${JSON.stringify(value).replaceAll('"', '""')}"`
  return `"${String(value).replaceAll('"', '""')}"`
}

const COLUMNS = ["createdAt", "type", "label", "outcome", "actorName", "actorEmail", "sourceIp", "userAgent", "documentFilename", "detail"] as const

/** CSV export of the activity feed for SOC 2 evidence collection — same filters as the page
 * (models/audit-events.ts's auditEventWhere), uncapped up to listWorkspaceAuditEventsForExport's
 * 10,000-row ceiling rather than the page's 200-row display limit. Modelled directly on
 * files/[fileId]/export/route.ts: a plain GET route rather than a server action, since a server
 * action can't hand back a file download; same requireWorkspaceRole guard, same self-audit of the
 * export itself. */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const url = new URL(request.url)
  const type = url.searchParams.get("type") || undefined
  const actorId = url.searchParams.get("actor") || undefined
  const fromParam = url.searchParams.get("from")
  const toParam = url.searchParams.get("to")
  const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : undefined
  // Inclusive of the whole selected day — the filter is a date picker, not a timestamp.
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : undefined

  const events = await listWorkspaceAuditEventsForExport(workspaceId, { type, actorId, from, to })

  // The audit trail otherwise only sees the events themselves, never the act of someone pulling
  // the whole trail out for a compliance review — same reasoning as the file export's self-audit.
  await recordDocumentAudit({ workspaceId, actorId: user.id, type: "activity_exported", detail: { count: events.length, type: type ?? null, actorId: actorId ?? null } })

  const rows = events.map((event) => ({
    createdAt: event.createdAt.toISOString(),
    type: event.type,
    label: event.label,
    outcome: event.outcome,
    actorName: event.actorName,
    actorEmail: event.actorEmail,
    sourceIp: event.sourceIp,
    userAgent: event.userAgent,
    documentFilename: event.documentFilename,
    detail: event.detail,
  }))

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${COLUMNS.map(csvCell).join(",")}\n`))
      for (const row of rows) controller.enqueue(new TextEncoder().encode(`${COLUMNS.map((key) => csvCell(row[key])).join(",")}\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=activity-${workspaceId}.csv`,
      "cache-control": "no-store",
    },
  })
}
