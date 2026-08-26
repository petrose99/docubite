import { getRequestAuditContext } from "@/lib/audit"
import { prisma } from "@/lib/db"

/** Fixed-window rate limiting in this app's own Postgres — the F14 backstop for Supabase's
 * built-in limiter (see AuthRateLimit's schema comment for why it isn't trusted alone).
 *
 * The window is truncated to a fixed boundary (floor(now / windowMs) * windowMs) rather than a
 * sliding "N requests in the last windowMs" — simpler, and the failure mode of a fixed window
 * (a burst can land up to 2x the limit across a boundary) is acceptable for a backstop that isn't
 * the primary control. */
export async function checkRateLimit(action: string, identifier: string, limit: number, windowMs: number): Promise<boolean> {
  const key = `${action}:${identifier}`
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs)
  const row = await prisma.authRateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  })
  return row.count <= limit
}

/** checkRateLimit against the current request's client IP, falling back to a shared bucket when
 * there is none to read (never fails the caller's flow over a missing header — a shared bucket
 * under load is a worse UX than no limiting, not a security hole, since Supabase's own limiter is
 * still the first line of defense). */
export async function checkRequestRateLimit(action: string, limit: number, windowMs: number): Promise<boolean> {
  const { sourceIp } = await getRequestAuditContext()
  return checkRateLimit(action, sourceIp ?? "unknown", limit, windowMs)
}
