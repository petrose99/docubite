/** Phase B: intended to flag a vendor/contact with no default expense account or tax rate
 * configured at the provider. Deliberately a no-op today (applicableCount always 0, matching
 * lib/health/score.ts's "nothing to say about this workspace" convention): none of the three
 * provider clients' vendor/contact list calls (quickbooks.listVendors, xero.listContacts,
 * bigcapital.listVendors — see lib/integrations/sync.ts's SyncRow) fetch or cache a default
 * expense account or default tax rate field for a vendor, so AccountingEntity has nothing for this
 * check to read. Wiring those fields through the sync (a Phase B non-goal per the ledger-sync
 * scope handed down) is a prerequisite for this check to do anything real — kept registered, with
 * a real CheckDefinition shape, so a later phase can fill in `run` without touching the registry
 * or the score-config UI again. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const contactDefaultsMissingCheck: CheckDefinition = {
  code: "contact_defaults_missing",
  name: "Contacts missing default account/tax rate",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (): CheckRunResult => ({ findings: [], applicableCount: 0 }),
}
