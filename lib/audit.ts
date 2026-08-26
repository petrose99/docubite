import { prisma } from "@/lib/db"
import type { Prisma, PrismaClient } from "@/prisma/client"
import { headers } from "next/headers"

/** Recording who touched ePHI, from where, and whether it worked (HIPAA §164.312(b)).
 *
 * Every write in this app used to be an inline `prisma.documentAuditEvent.create` at the call
 * site, which meant sourceIp/userAgent were never captured — nothing read next/headers() for
 * them. This is the one place that does, so every audit event gets the same treatment for free.
 *
 * Two entry points because half the 18 pre-existing call sites run inside the job worker, which
 * has no request behind it — next/headers() throws there, not returns empty. */

type AuditClient = PrismaClient | Prisma.TransactionClient

export type AuditOutcome = "success" | "failure" | "denied"

export type AuditContext = { sourceIp: string | null; userAgent: string | null }

type AuditInput = {
  workspaceId: string
  documentId?: string | null
  actorId?: string | null
  type: string
  outcome?: AuditOutcome
  detail?: Prisma.InputJsonValue
}

/** Client address and user agent for the request currently being handled, or all-null when there
 * is none (the job worker, scripts, tests). x-forwarded-for can carry a comma-separated chain
 * (client, proxy, proxy...); the first entry is the client Vercel saw. */
export async function getRequestAuditContext(): Promise<AuditContext> {
  try {
    const list = await headers()
    const forwarded = list.get("x-forwarded-for")
    const sourceIp = (forwarded ? forwarded.split(",")[0]?.trim() : null) || list.get("x-real-ip")
    return { sourceIp: sourceIp || null, userAgent: list.get("user-agent") }
  } catch {
    return { sourceIp: null, userAgent: null }
  }
}

/** Builds the `data` object for a documentAuditEvent.create — a plain, synchronous function so it
 * can be used inside `prisma.$transaction([...])`'s array form, which requires each element to be
 * a lazy Prisma query rather than an awaited value. Fetch the context with
 * getRequestAuditContext() first, then pass it in here alongside the array's other operations. */
export function auditEventData(input: AuditInput, context: AuditContext = { sourceIp: null, userAgent: null }) {
  return {
    workspaceId: input.workspaceId,
    documentId: input.documentId ?? null,
    actorId: input.actorId ?? null,
    type: input.type,
    outcome: input.outcome ?? "success",
    detail: input.detail,
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
  }
}

async function write(client: AuditClient, input: AuditInput, context: AuditContext) {
  // try/catch, not .catch(): if client.documentAuditEvent were ever undefined the property access
  // throws SYNCHRONOUSLY, before any promise exists for .catch() to attach to — and an audit write
  // must not be able to break the action it is auditing, by any route. Same reasoning as the
  // recordSearch helper this replaces (lib/retrieval.ts).
  try {
    await client.documentAuditEvent.create({ data: auditEventData(input, context) })
  } catch (error) {
    console.error(`[audit] failed to record ${input.type}:`, error instanceof Error ? error.message : error)
  }
}

/** Records one audit event for a request the app is currently handling — reads IP and user agent
 * off next/headers(). Use from route handlers, server actions, and page/layout renders. Pass a
 * transaction client when the write must land atomically with the change it describes; omit it to
 * write against the pool directly. Never call from the job worker — see recordSystemAudit. */
export async function recordDocumentAudit(input: AuditInput, client: AuditClient = prisma) {
  await write(client, input, await getRequestAuditContext())
}

/** Records one audit event with no request behind it: the job worker, background retries,
 * extraction/embedding completion. sourceIp and userAgent are always null — there is nothing to
 * read them from, and calling getRequestAuditContext() here would just throw and be swallowed. */
export async function recordSystemAudit(input: Omit<AuditInput, "actorId">, client: AuditClient = prisma) {
  await write(client, { ...input, actorId: null }, { sourceIp: null, userAgent: null })
}
