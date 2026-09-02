/** The health-check registry: every check the engine knows about, keyed by code. Mirrors
 * lib/modules/index.ts's shape — a flat array + pure lookups, no database. */
import { bankReconciliationCheck } from "@/lib/health/checks/bank-reconciliation"
import { confidenceDriftCheck } from "@/lib/health/checks/confidence-drift"
import { pushFailuresCheck } from "@/lib/health/checks/push-failures"
import { reviewBacklogCheck } from "@/lib/health/checks/review-backlog"
import { ruleCoverageCheck } from "@/lib/health/checks/rule-coverage"
import { staleDocumentsCheck } from "@/lib/health/checks/stale-documents"
import { uncorrectedLowConfidenceCheck } from "@/lib/health/checks/uncorrected-low-confidence"
import { ledgerDuplicateCheck } from "@/lib/health/checks/ledger-duplicate"
import { duplicateContactsCheck } from "@/lib/health/checks/duplicate-contacts"
import { multiCodedContactsCheck } from "@/lib/health/checks/multi-coded-contacts"
import { unreconciledTransactionsCheck } from "@/lib/health/checks/unreconciled-transactions"
import { dormantAccountsCheck } from "@/lib/health/checks/dormant-accounts"
import { contactDefaultsMissingCheck } from "@/lib/health/checks/contact-defaults-missing"
import { controlAccountPostingsCheck } from "@/lib/health/checks/control-account-postings"
import { uncodedTransactionsCheck } from "@/lib/health/checks/uncoded-transactions"
import { taxMismatchCheck } from "@/lib/health/checks/tax-mismatch"
import { taxConsistencyHealthCheck } from "@/lib/health/checks/tax-consistency"
import { vatNumberFormatCheck } from "@/lib/health/checks/vat-number-format"
import { missingTaxCheck } from "@/lib/health/checks/missing-tax"
import { submissionVolumeCheck } from "@/lib/health/checks/submission-volume"
import { automationRateCheck } from "@/lib/health/checks/automation-rate"
import { processingTimeCheck } from "@/lib/health/checks/processing-time"
import { reconciliationRateCheck } from "@/lib/health/checks/reconciliation-rate"
import type { CheckDefinition } from "@/lib/health/types"

// Every check runs and counts toward the score regardless of nav visibility — `hidden` below only
// sets showInNav: false. After 21 checks all landing as flat, equally-weighted-looking sidebar
// entries read as clutter (user feedback), the nav is cut down to the handful someone can act on
// directly: bank reconciliation, review backlog, failed pushes, duplicate bills, rule coverage
// gaps, and stale documents. Everything else still computes, still feeds the score and the
// Overview category chips — it just doesn't get a standing link of its own.
const hidden = (check: CheckDefinition): CheckDefinition => ({ ...check, showInNav: false })

export const REGISTRY: CheckDefinition[] = [
  reviewBacklogCheck,
  pushFailuresCheck,
  hidden(confidenceDriftCheck),
  hidden(uncorrectedLowConfidenceCheck),
  ruleCoverageCheck,
  staleDocumentsCheck,
  // Phase B: cleanup-category checks over synced ledger data — every one declares
  // requiresLedger: true, so runnableChecks below only runs them for a workspace that actually
  // has an active accounting connection.
  ledgerDuplicateCheck,
  hidden(duplicateContactsCheck),
  hidden(multiCodedContactsCheck),
  hidden(unreconciledTransactionsCheck),
  hidden(dormantAccountsCheck),
  hidden(contactDefaultsMissingCheck),
  hidden(controlAccountPostingsCheck),
  hidden(uncodedTransactionsCheck),
  // Bank reconciliation: also a cleanup-category check, but unlike every other check in this
  // block it declares requiresLedger: false — it works off uploaded bank_statement documents and
  // existing BankMatch rows (lib/bank-match/matcher.ts), not synced ledger data, so it has
  // something to say even for a workspace with no accounting connection at all.
  bankReconciliationCheck,
  // Phase C: tax-category checks — every one declares requiresLedger: true, same reasoning as
  // Phase B's cleanup checks (see the comment above), plus the pushed-document join tax_mismatch
  // and missing_tax need only exists once a workspace has a real ledger to compare against.
  hidden(taxMismatchCheck),
  hidden(taxConsistencyHealthCheck),
  hidden(vatNumberFormatCheck),
  hidden(missingTaxCheck),
  // Phase D: activity-category checks — every one declares defaultWeight: 0 (informational stat
  // cards, never scored — see lib/health/score.ts's computeHealthScore, which excludes a weight-0
  // entry from the weighted average entirely). reconciliationRateCheck alone declares
  // requiresLedger: true, same reasoning as Phase B/C's ledger checks. All four are informational
  // stats rather than actionable findings, so none get a standing nav entry either.
  hidden(submissionVolumeCheck),
  hidden(automationRateCheck),
  hidden(processingTimeCheck),
  hidden(reconciliationRateCheck),
]

export function findCheck(code: string | null | undefined): CheckDefinition | null {
  if (!code) return null
  return REGISTRY.find((check) => check.code === code) ?? null
}

/** Every check whose requiresLedger is false, plus — when `hasLedger` is true, i.e.
 * models/health.ts assembled a real (non-null) LedgerContext for this workspace — the ledger
 * checks too. Phase A always called this with no argument (hasLedger defaults to false), which
 * is still exactly Phase A's old behavior for a workspace with no accounting connection. */
export function runnableChecks(hasLedger: boolean = false): CheckDefinition[] {
  return REGISTRY.filter((check) => hasLedger || !check.requiresLedger)
}
