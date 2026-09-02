/** Phase B: flags an active AccountingEntity account with zero LedgerTransaction postings in the
 * last 90+ days — clutter in the chart of accounts that makes account pickers noisier than they
 * need to be. Looks across every synced transaction the context carries (not just the 30-day
 * dateRange window other Phase A checks use), since "dormant" is inherently a longer look-back. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const DORMANT_ACCOUNT_DAYS = 90

export const dormantAccountsCheck: CheckDefinition = {
  code: "dormant_accounts",
  name: "Dormant accounts",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const accounts = (ctx.ledger?.accountingEntities ?? []).filter((e) => e.entityType === "account" && e.active)
    const applicableCount = accounts.length
    if (!applicableCount) return { findings: [], applicableCount }

    const cutoff = new Date(ctx.dateRange.to.getTime() - DORMANT_ACCOUNT_DAYS * 24 * 60 * 60 * 1000)
    const recentAccountIds = new Set(
      (ctx.ledger?.transactions ?? [])
        .filter((t) => t.active && t.accountExternalId && t.txnDate && t.txnDate >= cutoff)
        .map((t) => t.accountExternalId as string),
    )

    const findings = accounts
      .filter((account) => !recentAccountIds.has(account.externalId))
      .map((account) => ({
        checkCode: "dormant_accounts",
        category: "cleanup" as const,
        severity: "info" as const,
        title: `"${account.name}" has had no postings in ${DORMANT_ACCOUNT_DAYS}+ days`,
        description: `This account is active in your chart of accounts but has no ledger transactions in the last ${DORMANT_ACCOUNT_DAYS} days.`,
        // Doubles as the fingerprint's disambiguator (models/health.ts's fingerprintFor is
        // `${checkCode}:${documentId}:${externalTransactionId}`) — without a distinct value per
        // account here, every dormant account in a workspace would collide onto the same
        // HealthCheckResult row and only the last one synced would ever get persisted.
        externalTransactionId: account.externalId,
        suggestedAction: null,
        suggestedActionPayload: { accountExternalId: account.externalId },
        affectedCount: 1,
      }))

    return { findings, applicableCount }
  },
}
