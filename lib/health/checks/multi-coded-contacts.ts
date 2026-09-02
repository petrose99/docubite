/** Phase B: flags a contact whose LedgerTransaction postings hit more than one distinct expense
 * account — often a coding-consistency smell (the same vendor should usually land on the same
 * account each time, absent a real reason otherwise). One finding per contact. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const multiCodedContactsCheck: CheckDefinition = {
  code: "multi_coded_contacts",
  name: "Inconsistently coded contacts",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const transactions = (ctx.ledger?.transactions ?? []).filter((t) => t.active && t.contactExternalId && t.accountExternalId)
    const contactIds = new Set(transactions.map((t) => t.contactExternalId as string))
    const applicableCount = contactIds.size
    if (!applicableCount) return { findings: [], applicableCount }

    const accountsByContact = new Map<string, Map<string, string>>() // contactId -> accountId -> accountName
    const contactNames = new Map<string, string>()
    for (const t of transactions) {
      const contactId = t.contactExternalId as string
      const accountId = t.accountExternalId as string
      contactNames.set(contactId, t.contactName ?? contactId)
      const accounts = accountsByContact.get(contactId) ?? new Map<string, string>()
      accounts.set(accountId, t.accountName ?? accountId)
      accountsByContact.set(contactId, accounts)
    }

    const findings: CheckRunResult["findings"] = []
    for (const [contactId, accounts] of accountsByContact) {
      if (accounts.size < 2) continue
      const accountNames = [...accounts.values()]
      findings.push({
        checkCode: "multi_coded_contacts",
        category: "cleanup",
        severity: "info",
        title: `${contactNames.get(contactId)} is coded to ${accounts.size} different accounts`,
        description: `Transactions for this contact posted to: ${accountNames.join(", ")}. Confirm this is intentional.`,
        // Doubles as the fingerprint's disambiguator, same reason dormant-accounts.ts sets it —
        // without a distinct value per contact, two different multi-coded contacts would collide.
        externalTransactionId: contactId,
        suggestedAction: null,
        suggestedActionPayload: { contactExternalId: contactId, accountExternalIds: [...accounts.keys()] },
        affectedCount: 1,
      })
    }

    return { findings, applicableCount }
  },
}
