import config from "@/lib/config"
import { verifyOAuthState } from "@/lib/integration-oauth-state"
import { syncAccountingEntities } from "@/lib/integrations/sync"
import { exchangeCodeForTokens } from "@/lib/integrations/quickbooks/client"
import { encryptSecret } from "@/lib/secret-crypto"
import { upsertWorkspaceIntegrationConnection } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { NextRequest } from "next/server"

/** QuickBooks OAuth callback. Verifies the signed state FIRST — before touching the code, the
 * workspace, or anything else — so a forged or expired callback is refused before any side effect.
 * `realmId` (QuickBooks' company id) arrives as its own callback query param, separate from `code`. */
export async function GET(request: NextRequest) {
  if (!config.integrations.quickbooks.enabled) return new Response("QuickBooks isn't configured on this deployment", { status: 404 })
  const params = request.nextUrl.searchParams
  const stateToken = params.get("state")
  const code = params.get("code")
  const realmId = params.get("realmId")
  if (params.get("error")) return new Response(`QuickBooks declined the connection: ${params.get("error")}`, { status: 400 })

  const state = stateToken ? verifyOAuthState(stateToken) : null
  if (!state || state.provider !== "quickbooks") return new Response("Invalid or expired connection request", { status: 400 })
  if (!code || !realmId) return new Response("QuickBooks callback is missing code or realmId", { status: 400 })

  // Re-check workspace access at the callback too — the state proves the request was signed for
  // this workspace/user, not that the user is still an owner of it right now.
  try {
    await requireWorkspaceRole(state.workspaceId, state.userId, ["owner"])
  } catch {
    return new Response("You no longer have access to this workspace", { status: 403 })
  }

  const redirectUri = `${config.app.baseURL}/api/integrations/quickbooks/callback`
  let tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number }
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri)
  } catch {
    return new Response("Could not complete the QuickBooks connection — please try again", { status: 502 })
  }

  const now = new Date()
  const connection = await upsertWorkspaceIntegrationConnection(state.workspaceId, {
    provider: "quickbooks",
    externalTenantId: realmId,
    tenantName: null, // QuickBooks doesn't return a company name on this exchange; shown as the realm id until set.
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
    refreshTokenExpiresAt: null, // QuickBooks refresh tokens are long-lived (~100 days) and rotate on use; not tracked precisely.
    scope: null,
    createdById: state.userId,
  })
  // Best effort: a first sync failure here must not block the connection itself — the owner can
  // always trigger it again from the "Sync accounts" button (integration-connection-actions.ts).
  await syncAccountingEntities(connection.id).catch((error) => console.error("[quickbooks] initial account sync failed:", error instanceof Error ? error.message : error))

  return Response.redirect(`${config.app.baseURL}/workspaces/${state.workspaceId}/settings/integrations`)
}
