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

export type XeroSyncedAccount = { code: string; name: string; active: boolean }
export type XeroSyncedContact = { id: string; name: string; active: boolean }
export type XeroSyncedTaxRate = { name: string; active: boolean }

/** All accounts (any class, any status) for WP1.5's chart-of-accounts sync — Xero has no
 * server-side pagination for /Accounts (unlike /Contacts), so this is a single request. */
export async function listAccounts(tenantId: string, accessToken: string): Promise<XeroSyncedAccount[]> {
  const result = await apiRequest<{ Accounts?: Array<{ Code?: string; Name: string; Status: string }> }>(tenantId, accessToken, "/Accounts")
  return (result.Accounts ?? []).filter((a) => a.Code).map((a) => ({ code: a.Code as string, name: a.Name, active: a.Status === "ACTIVE" }))
}

/** Every contact flagged as a supplier. /Contacts pages at 100 rows via the `page` query param;
 * a page shorter than the page size is Xero's own end-of-results signal for this endpoint. */
const CONTACTS_PAGE_SIZE = 100

export async function listContacts(tenantId: string, accessToken: string): Promise<XeroSyncedContact[]> {
  const contacts: XeroSyncedContact[] = []
  for (let page = 1; ; page++) {
    const result = await apiRequest<{ Contacts?: Array<{ ContactID: string; Name: string; ContactStatus: string }> }>(
      tenantId, accessToken, `/Contacts?where=${encodeURIComponent("IsSupplier==true")}&page=${page}`
    )
    const rows = result.Contacts ?? []
    contacts.push(...rows.map((row) => ({ id: row.ContactID, name: row.Name, active: row.ContactStatus === "ACTIVE" })))
    if (rows.length < CONTACTS_PAGE_SIZE) return contacts
  }
}

export async function listTaxRates(tenantId: string, accessToken: string): Promise<XeroSyncedTaxRate[]> {
  const result = await apiRequest<{ TaxRates?: Array<{ Name: string; Status: string }> }>(tenantId, accessToken, "/TaxRates")
  return (result.TaxRates ?? []).map((rate) => ({ name: rate.Name, active: rate.Status === "ACTIVE" }))
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

/** WP2.4: true when an ACCPAY invoice with this exact InvoiceNumber already exists at Xero —
 * the ledger-side duplicate guard checked in lib/integration-push.ts before every push. */
export async function findBillByInvoiceNumber(tenantId: string, accessToken: string, invoiceNumber: string): Promise<boolean> {
  const escaped = invoiceNumber.replace(/"/g, '\\"')
  const where = `Type=="ACCPAY" AND InvoiceNumber=="${escaped}"`
  const result = await apiRequest<{ Invoices?: Array<{ InvoiceID: string }> }>(tenantId, accessToken, `/Invoices?where=${encodeURIComponent(where)}`)
  return Boolean(result.Invoices?.length)
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
