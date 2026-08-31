import config from "@/lib/config"

/** Bigcapital's self-hosted (or hosted) API base. Unlike QuickBooks/Xero there is one host, no
 * sandbox/production split — isolation comes from each workspace getting its own organization on
 * that host, not from a separate environment. */
export function bigcapitalApiBase(): string {
  return config.integrations.bigcapital.apiBase
}
