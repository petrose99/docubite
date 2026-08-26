import { prisma } from "@/lib/db"
import { hashApiKey, looksLikeApiKey, parseBearerToken } from "@/lib/api-key"
import { unscoped } from "@/lib/workspace-scope"

/** Bearer-token authentication for the public /api/v1 surface. This is NOT session auth (getApiUser):
 * a request arrives with an API key in `Authorization: Bearer dbk_live_…` and no cookie, no user.
 *
 * The key is looked up by sha256 (we never store the plaintext), UNSCOPED — the key IS how the
 * workspace is discovered, so the lookup cannot itself be workspace-scoped, exactly like the Stripe
 * webhook handler finding a subscription by customer id. Everything the caller does AFTERWARDS is
 * scoped to the returned workspaceId.
 *
 * `lastUsedAt` is bumped fire-and-forget, and only when stale, so a busy key does not incur a write
 * on every request. */

const LAST_USED_STALE_MS = 5 * 60 * 1000

export type ApiAuthResult =
  | { ok: true; workspaceId: string; apiKeyId: string }
  | { ok: false; status: 401; errorCode: "missing_api_key" | "invalid_api_key" | "revoked_api_key" }

/** Prisma calls narrowed so the function can be tested against a mock. */
type ApiKeyStore = {
  findUnique(args: {
    where: { keyHash: string }
    select: { id: true; workspaceId: true; revokedAt: true; lastUsedAt: true }
  }): Promise<{ id: string; workspaceId: string; revokedAt: Date | null; lastUsedAt: Date | null } | null>
  update(args: { where: { id: string }; data: { lastUsedAt: Date } }): Promise<unknown>
}

export async function authenticateApiKey(authorization: string | null, store: ApiKeyStore, now = new Date()): Promise<ApiAuthResult> {
  const token = parseBearerToken(authorization)
  if (!token || !looksLikeApiKey(token)) return { ok: false, status: 401, errorCode: "missing_api_key" }

  const key = await store.findUnique({
    where: { keyHash: hashApiKey(token) },
    select: { id: true, workspaceId: true, revokedAt: true, lastUsedAt: true },
  })
  if (!key) return { ok: false, status: 401, errorCode: "invalid_api_key" }
  if (key.revokedAt) return { ok: false, status: 401, errorCode: "revoked_api_key" }

  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_STALE_MS) {
    // Fire-and-forget: a failed bump must never fail the request it is only annotating.
    void Promise.resolve(store.update({ where: { id: key.id }, data: { lastUsedAt: now } })).catch(() => {})
  }
  return { ok: true, workspaceId: key.workspaceId, apiKeyId: key.id }
}

/** The route-facing entry point: reads the header off a real Request and looks the key up through
 * the real Prisma client, unscoped. Thin wrapper over the testable core above. */
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  return unscoped(() => authenticateApiKey(req.headers.get("authorization"), prisma.workspaceApiKey))
}
