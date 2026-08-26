/** Workspace-scope enforcement for Prisma queries.
 *
 * Isolation in this app is app-level: every query is expected to carry `where: { workspaceId }`.
 * That works exactly as long as every author remembers, on every query, forever — and the failure
 * mode when someone forgets is not an error but a query that quietly returns other tenants' rows.
 *
 * This turns forgetting into a thrown exception. It is deliberately the FIRST of the two access
 * controls in the plan, ahead of Postgres RLS: it catches the same bug class, runs identically on
 * Neon's pooled connections, needs no database role changes, and can be reasoned about by reading
 * one file. RLS (lib/db-rls.ts) is the deeper guarantee and is staged behind proving this one. */

/** Models whose rows belong to exactly one workspace. A query against any of these without a
 * workspace filter is a bug unless it is explicitly marked unscoped.
 *
 * NOT listed, deliberately: User, Session, Account, Verification (identity, pre-workspace);
 * Workspace itself (the scoping root — filtering it by workspaceId is meaningless); WorkspaceMember
 * and WorkspaceInvitation (membership is how workspace access is *decided*, so it must be readable
 * before a workspace is known); StripeWebhookEvent and AdminAuditEvent (system-level); and the
 * child models reached only through a scoped parent (DocumentTemplateVersion, DocumentFileShare). */
export const WORKSPACE_SCOPED_MODELS = new Set([
  "Document",
  "DocumentFile",
  "DocumentFolder",
  "DocumentTemplate",
  "DocumentChunk",
  "DocumentFieldValue",
  "DocumentProcessingJob",
  "DocumentAuditEvent",
  "DocumentReportDraft",
  "ReportTemplate",
  "ExtractionShape",
  "SpreadsheetWorkbook",
  "AiFormulaCache",
  "WorkspaceUsagePeriod",
  "WorkspaceSubscription",
  // Outbound integrations (P1). WorkspaceApiKey is authenticated unscoped by keyHash (a UNIQUE
  // operation, so permitted), but every list/manage query is workspace-scoped. WebhookDelivery is
  // the queue row: like DocumentProcessingJob it is drained across all workspaces, and that global
  // drain wraps its claim in unscoped() (see lib/webhook-delivery.ts) exactly as the job worker does.
  "WorkspaceApiKey",
  "WebhookEndpoint",
  "WebhookDelivery",
  // Outbound integrations (P2): accounting connectors. IntegrationPush is drained across all
  // workspaces exactly like WebhookDelivery, and its global drain wraps its claim in unscoped()
  // (see lib/integration-push.ts).
  "IntegrationConnection",
  "IntegrationPush",
])

/** Operations that read or mutate an existing row set through a `where`, and so must be scoped.
 *
 * `create` is absent on purpose: it has no `where`, and its workspaceId is a required column the
 * database enforces. `createMany` likewise. */
const GUARDED_OPERATIONS = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
])

/** Operations addressing exactly one row by unique key. A unique id is unguessable and already
 * identifies a single row, so these are permitted unscoped — but callers should still prefer
 * findFirst with a workspaceId, which is why this is a separate, smaller list. */
const UNIQUE_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"])

/** True when a `where` argument constrains workspaceId at any depth a caller would reasonably use:
 * directly, inside AND/OR/NOT, or through a scoped relation (`file: { workspaceId }`). */
export function hasWorkspaceFilter(where: unknown, depth = 0): boolean {
  if (!where || typeof where !== "object" || depth > 4) return false
  const record = where as Record<string, unknown>
  if ("workspaceId" in record && record.workspaceId !== undefined) return true
  // A relation filter that itself pins the workspace scopes the query just as effectively.
  for (const [key, value] of Object.entries(record)) {
    if (value === null || typeof value !== "object") continue
    if (key === "AND" || key === "OR" || key === "NOT") {
      const branches = Array.isArray(value) ? value : [value]
      // OR is only scoped if EVERY branch is: one unscoped branch widens the whole query.
      const scoped = key === "OR" ? branches.every((branch) => hasWorkspaceFilter(branch, depth + 1)) : branches.some((branch) => hasWorkspaceFilter(branch, depth + 1))
      if (scoped) return true
      continue
    }
    if (hasWorkspaceFilter(value, depth + 1)) return true
  }
  return false
}

/** Set for the duration of an explicitly unscoped call. A module-level flag rather than a
 * parameter because Prisma's extension API gives the guard no way to receive one, and because the
 * flag must survive the awaits inside the query it wraps.
 *
 * Node runs one request's synchronous code at a time and this is set immediately before the query
 * and cleared in a finally, so the window is a single query's lifetime. */
let unscopedDepth = 0

/** Runs a callback with the workspace-scope guard lifted.
 *
 * For the queries that legitimately span workspaces: authentication (finding a user's memberships
 * before any workspace is known), the admin console, the Stripe webhook handler (which arrives with
 * a customer id, not a workspace), and background workers that claim jobs across all tenants.
 *
 * Every use is a deliberate, greppable statement that this query is meant to be unscoped. */
export async function unscoped<T>(fn: () => Promise<T>): Promise<T> {
  unscopedDepth++
  try {
    return await fn()
  } finally {
    unscopedDepth--
  }
}

export function isUnscoped(): boolean {
  return unscopedDepth > 0
}

export class WorkspaceScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation}() ran without a workspaceId filter. Workspace-scoped models must be ` +
      `filtered by workspace, or wrapped in unscoped() if crossing workspaces is genuinely intended.`,
    )
    this.name = "WorkspaceScopeError"
  }
}

/** Decides whether one query is allowed. Pure, so the policy can be tested without a database. */
export function checkWorkspaceScope(model: string | undefined, operation: string, args: unknown): void {
  if (!model || !WORKSPACE_SCOPED_MODELS.has(model)) return
  if (isUnscoped()) return
  if (UNIQUE_OPERATIONS.has(operation)) return
  if (!GUARDED_OPERATIONS.has(operation)) return
  const where = (args as { where?: unknown } | undefined)?.where
  if (!hasWorkspaceFilter(where)) throw new WorkspaceScopeError(model, operation)
}
