/** Xero OAuth + API endpoints. Unlike QuickBooks, Xero's tenant (organisation) id is not part of
 * the callback — it's fetched from /connections with the fresh access token right after the token
 * exchange (see lib/integrations/xero/client.ts::fetchConnections). */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize"
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
export const XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
export const XERO_SCOPES = "offline_access accounting.transactions accounting.contacts accounting.settings"
