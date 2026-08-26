import { authenticateApiRequest } from "@/lib/api-auth"
import config from "@/lib/config"

/** Shared helpers for the public /api/v1 route handlers: a uniform JSON error envelope and the
 * bearer-auth gate. Kept tiny and thin so the route files stay declarative. */

export type ApiContext = { workspaceId: string; apiKeyId: string }

export function apiError(status: number, code: string, message?: string): Response {
  return Response.json({ error: { code, message: message ?? code.replaceAll("_", " ") } }, { status })
}

/** Authenticates the request's API key, OR returns a ready-made 401/403 Response. Also refuses when
 * the deployment has integrations disabled (no encryption key) — the surface must be uniformly dark,
 * not half-open. Usage: `const auth = await requireApiAuth(req); if (auth instanceof Response) return auth`. */
export async function requireApiAuth(req: Request): Promise<ApiContext | Response> {
  if (!config.integrations.enabled) return apiError(404, "not_found")
  const auth = await authenticateApiRequest(req)
  if (!auth.ok) return apiError(auth.status, auth.errorCode)
  return { workspaceId: auth.workspaceId, apiKeyId: auth.apiKeyId }
}

/** Parses a positive integer query param within [min, max], falling back to `fallback`. */
export function parseLimit(value: string | null, fallback: number, max: number): number {
  const n = value ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}
