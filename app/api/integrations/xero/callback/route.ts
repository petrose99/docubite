import config from "@/lib/config"
import { verifyOAuthState } from "@/lib/integration-oauth-state"
import { exchangeCodeForTokens, fetchConnections } from "@/lib/integrations/xero/client"
import { syncAccountingEntities } from "@/lib/integrations/sync"
import { encryptSecret } from "@/lib/secret-crypto"
import { upsertWorkspaceIntegrationConnection } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { NextRequest } from "next/server"

/** Xero OAuth callback. Verifies the signed state FIRST, exactly as the QuickBooks callback does.
 * Xero's authorize step doesn't hand back a tenant id, so this fetches /connections with the fresh
 * access token to learn which organisation was actually authorized. */
export async function GET(request: NextRequest) {
  if (!config.integrations.xero.enabled) return new Response("Xero isn't configured on this deployment", { status: 404 })
  const params = request.nextUrl.searchParams
  const stateToken = params.get("state")
  const code = params.get("code")
  if (params.get("error")) return new Response(`Xero declined the connection: ${params.get("error")}`, { status: 400 })

  const state = stateToken ? verifyOAuthState(stateToken) : null
  if (!state || state.provider !== "xero") return new Response("Invalid or expired connection request", { status: 400 })
  if (!code) return new Response("Xero callback is missing code", { status: 400 })

  try {
    await requireWorkspaceRole(state.workspaceId, state.userId, ["owner"])
  } catch {
    return new Response("You no longer have access to this workspace", { status: 403 })
  }

  const redirectUri = `${config.app.baseURL}/api/integrations/xero/callback`
  let tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number }
  let connections: Array<{ tenantId: string; tenantName: string }>
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri)
    connections = await fetchConnections(tokens.accessToken)
  } catch {
    return new Response("Could not complete the Xero connection — please try again", { status: 502 })
  }
  const tenant = connections[0]
  if (!tenant) return new Response("No Xero organisation was authorized", { status: 400 })

  const now = new Date()
  const connection = await upsertWorkspaceIntegrationConnection(state.workspaceId, {
    provider: "xero",
    externalTenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
    refreshTokenExpiresAt: null, // Xero refresh tokens rotate on use and are valid ~60 days; not tracked precisely.
    scope: null,
    createdById: state.userId,
  })
  await syncAccountingEntities(connection.id).catch((error) => console.error("[xero] initial account sync failed:", error instanceof Error ? error.message : error))

  return Response.redirect(`${config.app.baseURL}/workspaces/${state.workspaceId}/settings/integrations`)
}
