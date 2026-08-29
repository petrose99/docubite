import config from "@/lib/config"
import { IntegrationAuthError } from "@/lib/integrations/errors"
import { QUICKBOOKS_TOKEN_URL, quickbooksCompanyBase } from "@/lib/integrations/quickbooks/config"
import { quickbooksApiError } from "@/lib/integrations/quickbooks/errors"

/** Thin fetch wrappers around the QuickBooks Online Accounting API. No SDK — the surface used here
 * (OAuth token exchange/refresh, a name-exact vendor query-or-create, one expense account list, one
 * bill create) is small enough that a dependency buys nothing. Every function throws (never returns
 * an error union) so callers use ordinary try/catch, matching the rest of the codebase's client
 * wrappers (e.g. lib/mineru.ts). */

const REQUEST_TIMEOUT_MS = 15_000

type TokenResponse = { accessToken: string; refreshToken: string; expiresInSeconds: number }

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${config.integrations.quickbooks.clientId}:${config.integrations.quickbooks.clientSecret}`).toString("base64")
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(QUICKBOOKS_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: basicAuthHeader(),
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new IntegrationAuthError(`quickbooks_token_http_${response.status}`)
    throw quickbooksApiError(response.status)
  }
  const json = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in }
}

/** Exchanges the callback's authorization `code` for an initial token pair. `redirectUri` must be
 * byte-identical to the one sent on the authorize request. */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }))
}

/** Refreshes an access token. QuickBooks rotates the refresh token on every use, so the caller must
 * persist the returned refreshToken, not just the accessToken. */
export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }))
}

async function apiRequest<T>(realmId: string, accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${quickbooksCompanyBase(realmId)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw quickbooksApiError(response.status)
  return (await response.json()) as T
}

/** Escapes a value for QuickBooks' SQL-like query language single-quoted string literals. */
function escapeQbQuery(value: string): string {
  return value.replace(/'/g, "\\'")
}

export type QuickBooksAccount = { id: string; name: string }

/** Lists expense accounts (AccountType = "Expense") for the settings UI's default-account picker. */
export async function listExpenseAccounts(realmId: string, accessToken: string): Promise<QuickBooksAccount[]> {
  const query = `select Id, Name from Account where AccountType = 'Expense' maxresults 200`
  const result = await apiRequest<{ QueryResponse?: { Account?: Array<{ Id: string; Name: string }> } }>(
    realmId, accessToken, `/query?query=${encodeURIComponent(query)}`
  )
  return (result.QueryResponse?.Account ?? []).map((a) => ({ id: a.Id, name: a.Name }))
}

const QUERY_PAGE_SIZE = 200

/** Pages through a QuickBooks query with `startposition`/`maxresults` until a page comes back
 * short of a full page — QuickBooks has no total-count or next-cursor field, so "fewer than asked
 * for" is the only end-of-results signal the API gives. */
async function paginatedQuery<Row>(realmId: string, accessToken: string, queryWithoutPaging: string, entityKey: string): Promise<Row[]> {
  const rows: Row[] = []
  let startPosition = 1
  for (;;) {
    const query = `${queryWithoutPaging} startposition ${startPosition} maxresults ${QUERY_PAGE_SIZE}`
    const result = await apiRequest<{ QueryResponse?: Record<string, Row[] | undefined> }>(realmId, accessToken, `/query?query=${encodeURIComponent(query)}`)
    const page = result.QueryResponse?.[entityKey] ?? []
    rows.push(...page)
    if (page.length < QUERY_PAGE_SIZE) return rows
    startPosition += QUERY_PAGE_SIZE
  }
}

export type QuickBooksSyncedAccount = { id: string; name: string; active: boolean }
export type QuickBooksSyncedVendor = { id: string; name: string; active: boolean }
export type QuickBooksSyncedTaxCode = { id: string; name: string; active: boolean }

/** All active accounts of any type, for WP1.5's chart-of-accounts sync — distinct from
 * listExpenseAccounts above, which stays scoped to the default-account picker's narrower need. */
export async function listAccounts(realmId: string, accessToken: string): Promise<QuickBooksSyncedAccount[]> {
  const rows = await paginatedQuery<{ Id: string; Name: string; Active: boolean }>(realmId, accessToken, "select Id, Name, Active from Account where Active = true", "Account")
  return rows.map((row) => ({ id: row.Id, name: row.Name, active: row.Active }))
}

export async function listVendors(realmId: string, accessToken: string): Promise<QuickBooksSyncedVendor[]> {
  const rows = await paginatedQuery<{ Id: string; DisplayName: string; Active: boolean }>(realmId, accessToken, "select Id, DisplayName, Active from Vendor where Active = true", "Vendor")
  return rows.map((row) => ({ id: row.Id, name: row.DisplayName, active: row.Active }))
}

export async function listTaxCodes(realmId: string, accessToken: string): Promise<QuickBooksSyncedTaxCode[]> {
  const rows = await paginatedQuery<{ Id: string; Name: string; Active: boolean }>(realmId, accessToken, "select Id, Name, Active from TaxCode where Active = true", "TaxCode")
  return rows.map((row) => ({ id: row.Id, name: row.Name, active: row.Active }))
}

/** Finds a vendor by exact DisplayName, or creates one. No fuzzy dedup — an exact match or a new
 * vendor, per scope. */
export async function findOrCreateVendor(realmId: string, accessToken: string, name: string): Promise<string> {
  const query = `select Id from Vendor where DisplayName = '${escapeQbQuery(name)}'`
  const found = await apiRequest<{ QueryResponse?: { Vendor?: Array<{ Id: string }> } }>(
    realmId, accessToken, `/query?query=${encodeURIComponent(query)}`
  )
  const existing = found.QueryResponse?.Vendor?.[0]
  if (existing) return existing.Id
  const created = await apiRequest<{ Vendor: { Id: string } }>(realmId, accessToken, "/vendor", {
    method: "POST",
    body: JSON.stringify({ DisplayName: name }),
  })
  return created.Vendor.Id
}

/** WP2.4: true when a bill with this exact DocNumber already exists at QuickBooks — the
 * ledger-side duplicate guard checked in lib/integration-push.ts before every push, independent
 * of this app's own duplicate detection (lib/checks/duplicates.ts), which only ever sees documents
 * this app itself has processed. */
export async function findBillByDocNumber(realmId: string, accessToken: string, docNumber: string): Promise<boolean> {
  const query = `select Id from Bill where DocNumber = '${escapeQbQuery(docNumber)}'`
  const result = await apiRequest<{ QueryResponse?: { Bill?: Array<{ Id: string }> } }>(realmId, accessToken, `/query?query=${encodeURIComponent(query)}`)
  return Boolean(result.QueryResponse?.Bill?.length)
}

/** Creates the bill. `body` is the exact shape from lib/integrations/quickbooks/bill-mapper.ts. */
export async function createBill(realmId: string, accessToken: string, body: unknown): Promise<{ id: string }> {
  const created = await apiRequest<{ Bill: { Id: string } }>(realmId, accessToken, "/bill", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return { id: created.Bill.Id }
}
