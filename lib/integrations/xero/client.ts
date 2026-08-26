import config from "@/lib/config"
import { IntegrationAuthError } from "@/lib/integrations/errors"
import { XERO_API_BASE, XERO_CONNECTIONS_URL, XERO_TOKEN_URL } from "@/lib/integrations/xero/config"
import { xeroApiError } from "@/lib/integrations/xero/errors"

/** Thin fetch wrappers around the Xero Accounting API + the tenant-discovery /connections endpoint.
 * No SDK, same rationale as lib/integrations/quickbooks/client.ts. Every function throws rather than
 * returning an error union. */

const REQUEST_TIMEOUT_MS = 15_000

type TokenResponse = { accessToken: string; refreshToken: string; expiresInSeconds: number }

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${config.integrations.xero.clientId}:${config.integrations.xero.clientSecret}`).toString("base64")
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: basicAuthHeader() },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new IntegrationAuthError(`xero_token_http_${response.status}`)
    throw xeroApiError(response.status)
  }
  const json = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }))
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }))
}

/** Fetches the tenant (organisation) connections available to this access token, right after the
 * initial token exchange — Xero's authorize step doesn't hand back a tenant id the way QuickBooks'
 * realmId does, so this is how the callback learns which organisation was actually authorized. */
export async function fetchConnections(accessToken: string): Promise<Array<{ tenantId: string; tenantName: string }>> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw xeroApiError(response.status)
  const json = (await response.json()) as Array<{ tenantId: string; tenantName: string }>
  return json.map((c) => ({ tenantId: c.tenantId, tenantName: c.tenantName }))
}

async function apiRequest<T>(tenantId: string, accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw xeroApiError(response.status)
  return (await response.json()) as T
}

export type XeroAccount = { code: string; name: string }

/** Lists expense accounts (Class = "EXPENSE") for the settings UI's default-account picker. */
export async function listExpenseAccounts(tenantId: string, accessToken: string): Promise<XeroAccount[]> {
  const result = await apiRequest<{ Accounts?: Array<{ Code: string; Name: string }> }>(
    tenantId, accessToken, `/Accounts?where=${encodeURIComponent('Class=="EXPENSE"')}`
  )
  return (result.Accounts ?? []).map((a) => ({ code: a.Code, name: a.Name }))
}

/** Finds a contact by exact Name, or creates one. No fuzzy dedup, per scope. */
export async function findOrCreateContact(tenantId: string, accessToken: string, name: string): Promise<string> {
  const found = await apiRequest<{ Contacts?: Array<{ ContactID: string }> }>(
    tenantId, accessToken, `/Contacts?where=${encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`)}`
  )
  const existing = found.Contacts?.[0]
  if (existing) return existing.ContactID
  const created = await apiRequest<{ Contacts: Array<{ ContactID: string }> }>(tenantId, accessToken, "/Contacts", {
    method: "PUT",
    body: JSON.stringify({ Contacts: [{ Name: name }] }),
  })
  return created.Contacts[0].ContactID
}

/** Creates the bill (an ACCPAY invoice). `body` is the exact shape from
 * lib/integrations/xero/bill-mapper.ts. */
export async function createBill(tenantId: string, accessToken: string, body: unknown): Promise<{ id: string }> {
  const created = await apiRequest<{ Invoices: Array<{ InvoiceID: string }> }>(tenantId, accessToken, "/Invoices", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return { id: created.Invoices[0].InvoiceID }
}
