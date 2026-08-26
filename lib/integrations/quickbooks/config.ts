import config from "@/lib/config"

/** QuickBooks Online OAuth + API endpoints. `environment` picks the accounting API host (the OAuth
 * host itself is the same for sandbox and production — QuickBooks distinguishes by the realm/company
 * the user connects, not by a separate authorize/token host). Sandbox by default (lib/config.ts), so
 * an unconfigured deployment can never accidentally write to a real company file. */

export const QUICKBOOKS_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
export const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
export const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting"

export function quickbooksApiBase(): string {
  return config.integrations.quickbooks.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com"
}

export function quickbooksCompanyBase(realmId: string): string {
  return `${quickbooksApiBase()}/v3/company/${realmId}`
}
