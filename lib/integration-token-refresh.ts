import { prisma } from "@/lib/db"
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto"
import { refreshTokens as refreshQuickbooksTokens } from "@/lib/integrations/quickbooks/client"
import { refreshTokens as refreshXeroTokens } from "@/lib/integrations/xero/client"
import { IntegrationAuthError } from "@/lib/integrations/errors"

/** Buffer before the recorded expiry at which a token is treated as already-expired, so a push
 * started a moment before the real deadline does not race a still-in-flight provider call against
 * the token going stale mid-request. */
const EXPIRY_BUFFER_MS = 2 * 60 * 1000

export class TokenRefreshError extends Error {}

/** Returns a decrypted, currently-valid access token for `connectionId`, refreshing it first if it
 * is expiring within the buffer. Holds a row lock (`SELECT ... FOR UPDATE`) for the whole read-or-
 * refresh-then-write, inside one interactive transaction, so two concurrent pushes against the same
 * connection cannot both decide to refresh and race each other's writes — the second one to reach
 * the lock sees the first one's already-fresh token and skips the refresh entirely.
 *
 * On a refresh failure that looks like the connection itself is no longer authorized (401/invalid
 * grant), the connection is marked "needs_reauth" and a TokenRefreshError is thrown with a stable,
 * non-retryable-looking code — the caller (lib/integration-push.ts) records that as the push's
 * terminal failure rather than retrying, since retrying an unauthorized connection can never
 * succeed on its own. Any other failure (network blip, provider 5xx) bubbles as a plain
 * TokenRefreshError the caller's normal retry/backoff handles like any other transient error. */
export async function getValidAccessToken(connectionId: string, now = new Date()): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string
        provider: string
        status: string
        access_token_enc: string
        refresh_token_enc: string
        access_token_expires_at: Date | null
      }>
    >`SELECT id, provider, status, access_token_enc, refresh_token_enc, access_token_expires_at
      FROM integration_connections WHERE id = ${connectionId} FOR UPDATE`
    const connection = rows[0]
    if (!connection) throw new TokenRefreshError("integration_connection_not_found")
    if (connection.status === "needs_reauth") throw new TokenRefreshError("integration_needs_reauth")

    const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0
    const stillFresh = expiresAt > now.getTime() + EXPIRY_BUFFER_MS
    if (stillFresh) {
      try {
        return decryptSecret(connection.access_token_enc)
      } catch {
        throw new TokenRefreshError("integration_token_decrypt_failed")
      }
    }

    let refreshToken: string
    try {
      refreshToken = decryptSecret(connection.refresh_token_enc)
    } catch {
      throw new TokenRefreshError("integration_token_decrypt_failed")
    }

    const refresh = connection.provider === "quickbooks" ? refreshQuickbooksTokens : refreshXeroTokens
    try {
      const refreshed = await refresh(refreshToken)
      await tx.$executeRaw`UPDATE integration_connections SET
          access_token_enc = ${encryptSecret(refreshed.accessToken)},
          refresh_token_enc = ${encryptSecret(refreshed.refreshToken)},
          access_token_expires_at = ${new Date(now.getTime() + refreshed.expiresInSeconds * 1000)},
          updated_at = ${now}
        WHERE id = ${connectionId}`
      return refreshed.accessToken
    } catch (error) {
      if (error instanceof IntegrationAuthError) {
        await tx.$executeRaw`UPDATE integration_connections SET status = 'needs_reauth', updated_at = ${now} WHERE id = ${connectionId}`
        throw new TokenRefreshError("integration_needs_reauth")
      }
      throw new TokenRefreshError("integration_token_refresh_failed")
    }
  })
}
