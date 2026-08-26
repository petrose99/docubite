import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { signOAuthState } from "@/lib/integration-oauth-state"
import { QUICKBOOKS_AUTHORIZE_URL, QUICKBOOKS_SCOPE } from "@/lib/integrations/quickbooks/config"
import { workspaceIntegrationsPlanEnabled } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { randomBytes } from "crypto"
import { NextRequest } from "next/server"

/** Owner-only, plan-gated: starts the QuickBooks connect flow by redirecting to Intuit's authorize
 * screen with a signed, short-lived `state` (lib/integration-oauth-state.ts) carrying the workspace
 * and user so the callback can trust it without a server-side session. */
export async function GET(request: NextRequest) {
  if (!config.integrations.quickbooks.enabled) return new Response("QuickBooks isn't configured on this deployment", { status: 404 })
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

  const state = signOAuthState({ workspaceId, userId: user.id, provider: "quickbooks", nonce: randomBytes(16).toString("hex") })
  const redirectUri = `${config.app.baseURL}/api/integrations/quickbooks/callback`
  const authorizeUrl = new URL(QUICKBOOKS_AUTHORIZE_URL)
  authorizeUrl.searchParams.set("client_id", config.integrations.quickbooks.clientId)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("scope", QUICKBOOKS_SCOPE)
  authorizeUrl.searchParams.set("state", state)
  return Response.redirect(authorizeUrl.toString())
}
