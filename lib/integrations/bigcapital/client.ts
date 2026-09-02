import { IntegrationAuthError } from "@/lib/integrations/errors"
import { bigcapitalApiBase } from "@/lib/integrations/bigcapital/config"
import { bigcapitalApiError } from "@/lib/integrations/bigcapital/errors"

/** Thin fetch wrappers around a self-hosted Bigcapital instance's REST API. No SDK, matching the
 * QuickBooks/Xero clients exactly (see lib/integrations/quickbooks/client.ts) — every function
 * throws rather than returning an error union.
 *
 * Every endpoint and field name here was verified against a real running Bigcapital instance
 * (signup → signin → build → poll → mint key → create vendor/item/bill), not guessed from docs —
 * several assumptions in an earlier version of this file were wrong (wrong sign-in endpoint/body
 * key, wrong response shapes, wrong bill-line reference). See models/bigcapital.ts for the
 * consequence that matters most: an account can build exactly ONE organization, ever — a second
 * `buildOrganization` call on the same account fails with `TENANT_ALREADY_BUILT`, which
 * `buildOrganization` below treats as an already-built result rather than an error.
 *
 * Two auth shapes coexist: `signup`/`signIn`/`buildOrganization`/`createApiKey` use the short-lived
 * JWT from sign-in; every data call after that (accounts, vendors, items, bills) uses the durable
 * per-org API key. Both need the `organization-id` header when authenticating with the JWT; an API
 * key is already tenant-scoped and appears to ignore the header, but it's sent regardless since
 * doing so is harmless and keeps every call site uniform. */

const REQUEST_TIMEOUT_MS = 15_000

type Auth = { token: string; organizationId: string }

async function request<T>(path: string, init: RequestInit, auth: Auth): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
    "organization-id": auth.organizationId,
    ...((init.headers as Record<string, string>) || {}),
  }
  const response = await fetch(`${bigcapitalApiBase()}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new IntegrationAuthError(`bigcapital_http_${response.status}`)
    throw bigcapitalApiError(response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** signup/signIn happen before an organization-id is known (signup CREATES the account's one
 * organization id; signIn is what first returns it) — a bare, unauthenticated request. */
async function publicRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${bigcapitalApiBase()}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...((init.headers as Record<string, string>) || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new IntegrationAuthError(`bigcapital_http_${response.status}`)
    throw bigcapitalApiError(response.status)
  }
  return (await response.json()) as T
}

export type BigcapitalSignupInput = { firstName: string; lastName: string; email: string; password: string }
export type BigcapitalSignupResult = { userId: string; organizationId: string }

/** Creates the real Bigcapital user account backing a workspace's BigcapitalAccount. Requires the
 * self-hosted instance to have email confirmation disabled (or an admin auto-confirm) — see the
 * "Open risks" note in the bridge plan; an instance requiring confirmation will leave the account
 * unusable until confirmed by hand. The response already carries the account's one-and-only
 * organization id, though its database isn't built yet — see buildOrganization. */
export async function signup(input: BigcapitalSignupInput): Promise<BigcapitalSignupResult> {
  const result = await publicRequest<{ user_id: number; organization_id: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ firstName: input.firstName, lastName: input.lastName, email: input.email, password: input.password }),
  })
  return { userId: String(result.user_id), organizationId: result.organization_id }
}

export type BigcapitalSession = { token: string; organizationId: string }

/** Signs in for a JWT plus the account's organization id. */
export async function signIn(email: string, password: string): Promise<BigcapitalSession> {
  const result = await publicRequest<{ access_token: string; organization_id: string }>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  return { token: result.access_token, organizationId: result.organization_id }
}

export type BuildOrganizationInput = {
  name: string
  location: string
  baseCurrency: string
  timezone: string
  /** A month name ("january".."december"), not a number — Bigcapital's fiscal-year-start field. */
  fiscalYear: string
  language: string
}

export type BuildOrganizationResult = { jobId: string; alreadyBuilt: false } | { jobId: null; alreadyBuilt: true }

/** Kicks off building this account's organization (its own database) — every account gets exactly
 * one; a second call on an account whose organization is already built fails with
 * `TENANT_ALREADY_BUILT` rather than creating another. Treated as success here (alreadyBuilt: true)
 * rather than an error: it's exactly the shape of a crash-then-retry after a build that actually
 * succeeded, which the idempotent provisioning flow needs to shrug off, not fail on. */
export async function buildOrganization(token: string, organizationId: string, input: BuildOrganizationInput): Promise<BuildOrganizationResult> {
  const response = await fetch(`${bigcapitalApiBase()}/api/organization/build`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}`, "organization-id": organizationId },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { errors?: Array<{ type?: string }> } | null
    if (body?.errors?.some((entry) => entry.type === "TENANT_ALREADY_BUILT")) return { jobId: null, alreadyBuilt: true }
    if (response.status === 401 || response.status === 403) throw new IntegrationAuthError(`bigcapital_http_${response.status}`)
    throw bigcapitalApiError(response.status)
  }
  const json = (await response.json()) as { data: { job_id: string } }
  return { jobId: json.data.job_id, alreadyBuilt: false }
}

export type BuildJobStatus = { completed: boolean; failed: boolean }

export async function getBuildJobStatus(token: string, organizationId: string, jobId: string): Promise<BuildJobStatus> {
  const result = await request<{ is_completed: boolean; is_failed: boolean }>(
    `/api/organization/build/${jobId}`,
    { method: "GET" },
    { token, organizationId }
  )
  return { completed: result.is_completed, failed: result.is_failed }
}

/** Mints a durable per-org API key — the credential IntegrationConnection.accessTokenEnc stores
 * from here on, so the cached sign-in JWT can be discarded rather than kept alive. */
export async function createApiKey(token: string, organizationId: string, name: string): Promise<{ key: string }> {
  const result = await request<{ key: string; id: number }>(
    "/api/api-keys/generate",
    { method: "POST", body: JSON.stringify({ name }) },
    { token, organizationId }
  )
  return { key: result.key }
}

export type BigcapitalSyncedAccount = { id: string; name: string; active: boolean }
export type BigcapitalSyncedVendor = { id: string; name: string; active: boolean }

/** Chart of accounts for the initial post-provision sync (WP1.5-equivalent) — same shape as
 * quickbooks.listAccounts / xero.listAccounts so lib/integrations/sync.ts can treat all three
 * uniformly. `active` is `1`/`0` on the wire, not `true`/`false`. */
export async function listAccounts(apiKey: string, organizationId: string): Promise<BigcapitalSyncedAccount[]> {
  const result = await request<{ accounts: Array<{ id: number; name: string; active: number }> }>(
    "/api/accounts",
    { method: "GET" },
    { token: apiKey, organizationId }
  )
  return result.accounts.map((a) => ({ id: String(a.id), name: a.name, active: Boolean(a.active) }))
}

/** Vendors, and every other list endpoint on this API (bills, items, …), are paginated under a
 * `data` key — never a `vendors`/`bills`/`items` key as an earlier version of this file assumed. */
export async function listVendors(apiKey: string, organizationId: string): Promise<BigcapitalSyncedVendor[]> {
  const result = await request<{ data: Array<{ id: number; display_name: string; active: number }> }>(
    "/api/vendors",
    { method: "GET" },
    { token: apiKey, organizationId }
  )
  return result.data.map((v) => ({ id: String(v.id), name: v.display_name, active: Boolean(v.active) }))
}

/** Finds a vendor by exact (case-insensitive) name, or creates one. No fuzzy dedup, same scope as
 * quickbooks.findOrCreateVendor. Bigcapital has no documented search-by-name endpoint, so this pages
 * through the same list the sync uses rather than a dedicated query — acceptable at push volume,
 * revisit if a workspace's vendor list grows large enough to make this slow. */
export async function findOrCreateVendor(apiKey: string, organizationId: string, name: string): Promise<string> {
  const existing = (await listVendors(apiKey, organizationId)).find((v) => v.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing.id
  const created = await request<{ id: number }>(
    "/api/vendors",
    { method: "POST", body: JSON.stringify({ display_name: name }) },
    { token: apiKey, organizationId }
  )
  return String(created.id)
}

/** A bill line references a catalog Item (which itself carries the expense-side account), not an
 * account directly — Bigcapital rejects a bill entry with no `item_id` (`isInt`/`isNotEmpty` on
 * `itemId`). One generic, non-sellable "expense item" per default-expense-account is find-or-created
 * here so a push never needs the workspace owner to have set up a real item catalog first. */
export async function findOrCreateExpenseItem(apiKey: string, organizationId: string, accountId: string): Promise<string> {
  const itemName = `DocuBite expense (account ${accountId})`
  const existing = await request<{ data: Array<{ id: number; name: string; cost_account_id: number | null }> }>(
    "/api/items",
    { method: "GET" },
    { token: apiKey, organizationId }
  )
  const found = existing.data.find((item) => item.name === itemName && String(item.cost_account_id) === accountId)
  if (found) return String(found.id)
  const created = await request<{ id: number }>(
    "/api/items",
    { method: "POST", body: JSON.stringify({ name: itemName, type: "service", sellable: false, purchasable: true, cost_account_id: Number(accountId), cost_price: 0 }) },
    { token: apiKey, organizationId }
  )
  return String(created.id)
}

/** WP2.4-equivalent: true when a bill with this exact bill_number already exists at Bigcapital —
 * checked before every push, same as quickbooks.findBillByDocNumber / xero.findBillByInvoiceNumber.
 * Bigcapital has no documented filter-by-number query param, so this checks the first page of bills
 * client-side — fine at the volume a single workspace's ledger holds. */
export async function findBillByReferenceNumber(apiKey: string, organizationId: string, referenceNumber: string): Promise<boolean> {
  const result = await request<{ data: Array<{ bill_number: string | null }> }>("/api/bills", { method: "GET" }, { token: apiKey, organizationId })
  return result.data.some((b) => b.bill_number === referenceNumber)
}

/** Creates the bill. `body` is the exact shape from lib/integrations/bigcapital/bill-mapper.ts. */
export async function createBill(apiKey: string, organizationId: string, body: unknown): Promise<{ id: string }> {
  const created = await request<{ id: number }>(
    "/api/bills",
    { method: "POST", body: JSON.stringify(body) },
    { token: apiKey, organizationId }
  )
  return { id: String(created.id) }
}

/** Voids (deletes) a bill via `DELETE /api/bills/{id}` — Bigcapital has no separate void/cancel
 * status transition for bills the way QuickBooks/Xero do, only a hard delete of the bill record,
 * per its route table. Throws exactly like createBill on any non-2xx response (`request`'s own
 * error handling). This IS a real, irreversible write against whatever organizationId points at —
 * callers must treat it with the same care as createBill, and it must never be exercised against a
 * live organization without explicit human go-ahead first. */
export async function voidBill(apiKey: string, organizationId: string, billId: string): Promise<void> {
  await request<void>(`/api/bills/${billId}`, { method: "DELETE" }, { token: apiKey, organizationId })
}

// ---- Phase B: ledger sync ----------------------------------------------------------------------

export type BigcapitalLedgerTransaction = {
  id: string
  docNumber: string | null
  txnDate: string | null
  total: number | null
  taxAmount: number | null
  currencyCode: string | null
  contactId: string | null
  contactName: string | null
  /** The first entry's cost_account_id — a bill/expense can have several lines against several
   * accounts (see the `entries` shape verified against a real instance below); the first is taken
   * as this transaction's representative account, same simplification the QuickBooks/Xero
   * ledger-sync functions make. */
  accountId: string | null
  accountName: string | null
}

type BigcapitalBillEntry = { cost_account_id: number | null; item?: { name?: string; cost_account_id?: number | null } }

function firstEntryAccount(entries: BigcapitalBillEntry[] | undefined): { accountId: string | null; accountName: string | null } {
  const entry = entries?.find((e) => e.cost_account_id != null)
  if (!entry) return { accountId: null, accountName: null }
  return { accountId: String(entry.cost_account_id), accountName: entry.item?.name ?? null }
}

/** Bills (vendor bills, AP) for Phase B's ledger sync — the exact response envelope (`{data:
 * [...], pagination}`, per-entry `cost_account_id`, `bill_number`/`bill_date`/`total`/
 * `tax_amount_withheld` field names) was verified against a real running Bigcapital instance, not
 * guessed from docs, same as every other function in this file. */
export async function listBills(apiKey: string, organizationId: string): Promise<BigcapitalLedgerTransaction[]> {
  type Row = {
    id: number; bill_number: string | null; bill_date: string | null; total: number | null
    tax_amount_withheld: number | null; currency_code: string | null
    vendor_id: number | null; vendor?: { id: number; display_name: string } | null
    entries?: BigcapitalBillEntry[]
  }
  const bills: BigcapitalLedgerTransaction[] = []
  for (let page = 1; ; page++) {
    const result = await request<{ data: Row[]; pagination: { total: number; page: number; page_size: number } }>(
      `/api/bills?page=${page}`, { method: "GET" }, { token: apiKey, organizationId }
    )
    bills.push(...result.data.map((row): BigcapitalLedgerTransaction => ({
      id: String(row.id), docNumber: row.bill_number, txnDate: row.bill_date, total: row.total,
      taxAmount: row.tax_amount_withheld, currencyCode: row.currency_code,
      contactId: row.vendor_id != null ? String(row.vendor_id) : null, contactName: row.vendor?.display_name ?? null,
      ...firstEntryAccount(row.entries),
    })))
    if (result.data.length === 0 || result.data.length < result.pagination.page_size) return bills
  }
}

/** Quick expenses (petty-cash/card spend not routed through the AP bill workflow) for Phase B's
 * ledger sync — Bigcapital DOES distinguish expenses from bills (a separate `/api/expenses`
 * endpoint exists on the real instance verified for this phase, returning the same `{data: [...],
 * pagination}` envelope as every other list endpoint here), but that organization had zero
 * expenses recorded, so this mapping's field names (`payment_date`/`reference_no`/`total_amount`/
 * `payment_account_id`) are inferred from the same naming conventions every other Bigcapital
 * endpoint in this file uses, NOT verified against a real expense row — flagged explicitly as
 * unverified in the Phase B report. */
export async function listExpenses(apiKey: string, organizationId: string): Promise<BigcapitalLedgerTransaction[]> {
  type Row = {
    id: number; reference_no: string | null; payment_date: string | null
    total_amount: number | null; currency_code: string | null
    payee_id: number | null; payee?: { id: number; display_name?: string; formatted_name?: string } | null
    payment_account_id: number | null; payment_account?: { name?: string } | null
  }
  const expenses: BigcapitalLedgerTransaction[] = []
  for (let page = 1; ; page++) {
    const result = await request<{ data: Row[]; pagination: { total: number; page: number; page_size: number } }>(
      `/api/expenses?page=${page}`, { method: "GET" }, { token: apiKey, organizationId }
    )
    expenses.push(...result.data.map((row): BigcapitalLedgerTransaction => ({
      id: String(row.id), docNumber: row.reference_no, txnDate: row.payment_date, total: row.total_amount,
      taxAmount: null, currencyCode: row.currency_code,
      contactId: row.payee_id != null ? String(row.payee_id) : null,
      contactName: row.payee?.display_name ?? row.payee?.formatted_name ?? null,
      accountId: row.payment_account_id != null ? String(row.payment_account_id) : null,
      accountName: row.payment_account?.name ?? null,
    })))
    if (result.data.length === 0 || result.data.length < result.pagination.page_size) return expenses
  }
}
