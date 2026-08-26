import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { signOAuthState } from "@/lib/integration-oauth-state"
import { XERO_AUTHORIZE_URL, XERO_SCOPES } from "@/lib/integrations/xero/config"
import { workspaceIntegrationsPlanEnabled } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { randomBytes } from "crypto"
import { NextRequest } from "next/server"

/** Owner-only, plan-gated: starts the Xero connect flow. Same shape as the QuickBooks connect
 * route — see app/api/integrations/quickbooks/connect/route.ts. */
export async function GET(request: NextRequest) {
  if (!config.integrations.xero.enabled) return new Response("Xero isn't configured on this deployment", { status: 404 })
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })

  const user = await getCurrentUser()
  try {
    await requireWorkspaceRole(workspaceId, user.id, ["owner"])
  } catch {
    return new Response("Only workspace owners can connect an accounting provider", { status: 403 })
  }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) {
    return new Response("Integrations are available on a paid plan", { status: 403 })
  }

  const state = signOAuthState({ workspaceId, userId: user.id, provider: "xero", nonce: randomBytes(16).toString("hex") })
  const redirectUri = `${config.app.baseURL}/api/integrations/xero/callback`
  const authorizeUrl = new URL(XERO_AUTHORIZE_URL)
  authorizeUrl.searchParams.set("client_id", config.integrations.xero.clientId)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("scope", XERO_SCOPES)
  authorizeUrl.searchParams.set("state", state)
  return Response.redirect(authorizeUrl.toString())
}
