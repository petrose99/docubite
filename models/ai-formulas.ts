// Not a "use server" module: like models/spreadsheets.ts, these helpers trust the workspaceId
// they are handed. Authorisation happens in the caller (sheet-actions.ts).
import { prisma } from "@/lib/db"

/** A previous answer to exactly this call, if the workspace has one. */
export async function getCachedAiFormula(workspaceId: string, hash: string): Promise<string | null> {
  const row = await prisma.aiFormulaCache.findUnique({ where: { workspaceId_hash: { workspaceId, hash } }, select: { result: true } })
  return row?.result ?? null
}

/** Stores an answer against its call.
 *
 * An upsert rather than a create because two cells with the same formula recalculate at the same
 * moment on load, and losing that race must not fail the formula — the second writer is storing
 * the identical answer anyway. */
export async function cacheAiFormula(input: { workspaceId: string; hash: string; result: string; model: string }): Promise<void> {
  await prisma.aiFormulaCache.upsert({
    where: { workspaceId_hash: { workspaceId: input.workspaceId, hash: input.hash } },
    create: { workspaceId: input.workspaceId, hash: input.hash, result: input.result, model: input.model },
    update: { result: input.result, model: input.model },
  })
}
