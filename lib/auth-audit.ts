import { prisma } from "@/lib/db"
import { getRequestAuditContext } from "@/lib/audit"
import type { Prisma } from "@/prisma/client"

/** Writes to AdminAuditEvent, the platform-level trail that survives its subject (see the model's
 * doc comment in prisma/schema.prisma) — used for actions with no workspace to scope a
 * DocumentAuditEvent to (workspace deletion, auth events before a session exists) or that must
 * outlive the workspace being destroyed. AdminAuditEvent has no sourceIp/userAgent columns, so the
 * request context is folded into detail instead of dropped.
 *
 * Never throws, same reasoning as lib/audit.ts's write(): an audit failure must not be able to
 * break the action it is auditing. */
export async function recordAdminAudit(input: {
  actorId?: string | null
  type: string
  targetUserId?: string | null
  targetWorkspaceId?: string | null
  detail?: Prisma.InputJsonValue
}) {
  try {
    const context = await getRequestAuditContext()
    await prisma.adminAuditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        type: input.type,
        targetUserId: input.targetUserId ?? null,
        targetWorkspaceId: input.targetWorkspaceId ?? null,
        detail: { ...(input.detail as object | undefined), sourceIp: context.sourceIp, userAgent: context.userAgent },
      },
    })
  } catch (error) {
    console.error(`[auth-audit] failed to record ${input.type}:`, error instanceof Error ? error.message : error)
  }
}
