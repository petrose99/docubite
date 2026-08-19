import config from "@/lib/config"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/prisma/client"

/** Row-level security scoping.
 *
 * The policies installed by the 20260819190000 migration compare each row's workspace_id against
 * the `app.workspace_id` session setting. This is what sets it.
 *
 * SET LOCAL, inside an interactive transaction, is the whole design:
 *
 * - LOCAL means the setting is reverted when the transaction ends. Under PgBouncer transaction
 *   pooling the connection is immediately reused by another request, and a session-level setting
 *   would carry one tenant's scope into another tenant's query — turning a safety feature into the
 *   exact leak it exists to prevent.
 * - Inside a transaction means the setting and the queries it governs are guaranteed to be on the
 *   same connection. Setting it outside one would scope a connection the next query might not get.
 *
 * With DB_RLS_ENABLED off (the default) this is a plain transaction with no SET, so it is safe to
 * adopt at call sites before the database side is switched on. */

/** Runs `fn` with the database session scoped to one workspace.
 *
 * Every query inside sees only that workspace's rows, enforced by Postgres rather than by the
 * query's own where clause. The transaction client MUST be used inside — a query issued against
 * the global `prisma` from within the callback runs on a different connection and is unscoped. */
export async function withWorkspace<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (config.isolation.rlsEnabled) {
      // set_config's third argument is is_local=true, i.e. SET LOCAL. Parameterised rather than
      // interpolated: workspaceId reaching SQL text unescaped would be an injection point in the
      // one place that must not have one.
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}::text, true)`
    }
    return fn(tx)
  })
}

/** Reports whether RLS scoping is actually in force, for a health check or an admin screen — so
 * "we have RLS" can be verified rather than assumed. */
export async function isRlsActive(): Promise<{ enabled: boolean; policies: number; forcedTables: number }> {
  if (!config.isolation.rlsEnabled) return { enabled: false, policies: 0, forcedTables: 0 }
  const [policies] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%_workspace_isolation'`,
  )
  const [forced] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relrowsecurity = true`,
  )
  return { enabled: true, policies: Number(policies?.count ?? 0), forcedTables: Number(forced?.count ?? 0) }
}
