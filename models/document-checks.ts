// Deliberately NOT a "use server" module, matching every other models/*.ts helper in this
// package: this trusts the documentId/workspaceId it is handed. Called from the worker
// (lib/document-processing.ts), which has already authorised the document by construction.
import { track } from "@/lib/analytics"
import { checkInvoiceArithmetic } from "@/lib/checks/arithmetic"
import { checkStatementBalance } from "@/lib/checks/balance"
import { findNearDuplicate, type DocumentIdentity } from "@/lib/checks/duplicates"
import { findMissingStatementPeriods } from "@/lib/checks/statement-periods"
import { checkTaxConsistency } from "@/lib/checks/tax-consistency"
import type { CheckResult } from "@/lib/checks/types"
import { checkVatNumber } from "@/lib/checks/vat-number"
import { prisma } from "@/lib/db"
import { createReviewTask } from "@/models/review-tasks"
import { getTaxProfile } from "@/models/tax-profiles"
import { Prisma } from "@/prisma/client"

/** Which reviewedData keys each finance template (lib/domains/finance.ts) uses for the concepts
 * the checks above compare — the same "per-template field name" problem
 * lib/automation/rules.ts's SUPPLIER_FIELD_BY_TEMPLATE solves, extended with every field a check
 * needs. Templates absent here (generic, bank domain packs' own non-finance templates) simply run
 * no checks — not every document has arithmetic or a balance to verify. */
type CheckFieldMap = {
  supplier?: string; invoiceNumber?: string; date?: string
  subtotal?: string; taxTotal?: string; total?: string; currency?: string; lineItems?: string
  accountNumber?: string; openingBalance?: string; closingBalance?: string; periodStart?: string; periodEnd?: string; transactions?: string
  supplierVatNumber?: string
}

const CHECK_FIELD_MAPS: Record<string, CheckFieldMap> = {
  invoice: { supplier: "vendor", invoiceNumber: "invoice_number", date: "issue_date", subtotal: "subtotal", taxTotal: "tax_total", total: "total", currency: "currency_code", lineItems: "line_items", supplierVatNumber: "supplier_vat_number" },
  receipt: { supplier: "merchant", invoiceNumber: "receipt_number", date: "purchase_date", taxTotal: "tax_total", total: "total", currency: "currency_code", lineItems: "line_items" },
  expense_receipt: { supplier: "merchant", invoiceNumber: "receipt_number", date: "purchase_date", taxTotal: "tax_total", total: "total", currency: "currency_code" },
  purchase_order: { supplier: "supplier", invoiceNumber: "po_number", date: "order_date", total: "total", currency: "currency_code", lineItems: "line_items" },
  bank_statement: { accountNumber: "account_number", openingBalance: "opening_balance", closingBalance: "closing_balance", periodStart: "statement_period_start", periodEnd: "statement_period_end", transactions: "transactions", currency: "currency_code" },
}

/** Only these two default to "fail" — every other check defaults to "warn" (the roadmap's own
 * call): a wrong total or a knowingly-reingested file are not judgment calls, everything else
 * (a statement's own rounding, a rate mismatch, a plausible near-dupe) is worth a look, not a
 * block. "duplicate" is fail only for its exact-match branch — see runDeterministicChecks. */
const FAIL_BY_DEFAULT = new Set(["invoice_arithmetic"])

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Runs every applicable deterministic check for one document, persists each result (upserted by
 * (documentId, checkCode), so a reprocess updates the same row rather than accumulating history —
 * DocumentAuditEvent is where history lives), and opens a ReviewTask + emits an analytics event
 * for any check that came back warn or fail. Never throws past the caller, matching every other
 * post-extraction side effect in lib/document-processing.ts. */
export async function runDeterministicChecks(input: { workspaceId: string; documentId: string }): Promise<void> {
  try {
    const document = await prisma.document.findFirst({
      where: { id: input.documentId, workspaceId: input.workspaceId },
      select: { id: true, templateId: true, reviewedData: true, template: { select: { code: true } } },
    })
    if (!document?.template) return
    const map = CHECK_FIELD_MAPS[document.template.code]
    if (!map) return

    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const get = (key: keyof CheckFieldMap) => (map[key] ? values[map[key] as string] : undefined)
    const currencyCode = asString(get("currency"))
    const lineItems = Array.isArray(get("lineItems")) ? (get("lineItems") as unknown[]).map((item) => ({ amount: asNumber((item as Record<string, unknown> | null)?.amount) })) : []

    const results: CheckResult[] = []

    if (map.total || map.subtotal) {
      const arithmetic = checkInvoiceArithmetic({ currencyCode, subtotal: asNumber(get("subtotal")), taxTotal: asNumber(get("taxTotal")), total: asNumber(get("total")), lineItems })
      if (arithmetic) results.push(arithmetic)
    }

    if (map.openingBalance && map.closingBalance) {
      const transactions = Array.isArray(get("transactions")) ? (get("transactions") as unknown[]).map((row) => ({ debit: asNumber((row as Record<string, unknown> | null)?.debit), credit: asNumber((row as Record<string, unknown> | null)?.credit) })) : []
      const balance = checkStatementBalance({ currencyCode, openingBalance: asNumber(get("openingBalance")), closingBalance: asNumber(get("closingBalance")), transactions })
      if (balance) results.push(balance)
    }

    const taxProfile = map.taxTotal || map.supplierVatNumber ? await getTaxProfile(input.workspaceId) : null

    if (map.taxTotal && taxProfile) {
      // expense_receipt has no subtotal field; derive it from total - tax when both are present,
      // since "subtotal" here means only "the base the rate applies to", not a printed field.
      const subtotal = asNumber(get("subtotal")) ?? (asNumber(get("total")) !== null && asNumber(get("taxTotal")) !== null ? (asNumber(get("total")) as number) - (asNumber(get("taxTotal")) as number) : null)
      const taxConsistency = checkTaxConsistency({ currencyCode, documentDate: asDate(get("date")), subtotal, taxTotal: asNumber(get("taxTotal")), rates: taxProfile.config.rates })
      if (taxConsistency) results.push(taxConsistency)
    }

    if (map.supplierVatNumber && taxProfile?.config.registrationNumberPattern) {
      const vatNumber = checkVatNumber({ vatNumber: asString(get("supplierVatNumber")), registrationNumberPattern: taxProfile.config.registrationNumberPattern })
      if (vatNumber) results.push(vatNumber)
    }

    if (map.supplier && map.invoiceNumber && map.total) {
      const identity: DocumentIdentity = { documentId: document.id, supplier: asString(get("supplier")), invoiceNumber: asString(get("invoiceNumber")), total: asNumber(get("total")), currencyCode }
      results.push(...(await checkDuplicates(input.workspaceId, document.templateId, identity)))
      const resubmission = await checkSuspiciousResubmission(input.workspaceId, document.id, identity)
      if (resubmission) results.push(resubmission)
    }

    if (map.accountNumber && map.periodStart && map.periodEnd) {
      const accountNumber = asString(get("accountNumber"))
      if (accountNumber) {
        const periods = await siblingStatementPeriods(input.workspaceId, document.templateId, document.id, accountNumber, map)
        const missing = findMissingStatementPeriods(periods)
        if (missing) results.push(missing)
      }
    }

    for (const result of results) await persistCheckResult(input.workspaceId, document.id, result)
  } catch (error) {
    console.error("[checks] failed to run deterministic checks:", error instanceof Error ? error.message : error)
  }
}

async function persistCheckResult(workspaceId: string, documentId: string, result: CheckResult): Promise<void> {
  const status = result.status === "fail" && !FAIL_BY_DEFAULT.has(result.checkCode) && result.checkCode !== "duplicate" ? "warn" : result.status
  await prisma.documentCheckResult.upsert({
    where: { documentId_checkCode: { documentId, checkCode: result.checkCode } },
    create: { workspaceId, documentId, checkCode: result.checkCode, status, message: result.message, detail: (result.detail ?? null) as Prisma.InputJsonValue },
    update: { status, message: result.message, detail: (result.detail ?? null) as Prisma.InputJsonValue },
  })
  if (status === "pass") return

  await track("document_check_failed", { documentId, checkCode: result.checkCode, status: status as "warn" | "fail" }, { workspaceId })
  // One open review task per (document, check) — a reprocess that still fails the same check
  // must not pile up duplicate tasks every run.
  const existing = await prisma.reviewTask.findFirst({ where: { workspaceId, documentId, reason: "check_failed", status: { in: ["open", "in_review"] }, detail: { contains: result.checkCode } }, select: { id: true } })
  if (!existing) await createReviewTask({ workspaceId, documentId, reason: "check_failed", detail: `${result.checkCode}: ${result.message}`, priority: status === "fail" ? 1 : 0, createdById: null })
}

async function checkDuplicates(workspaceId: string, templateId: string | null, identity: DocumentIdentity): Promise<CheckResult[]> {
  const ingestion = await prisma.ingestionItem.findFirst({ where: { workspaceId, documentId: identity.documentId }, select: { status: true } })
  if (ingestion?.status === "duplicate") {
    return [{ checkCode: "duplicate", status: "fail", message: "This exact file was already ingested into this workspace.", detail: { exact: true } }]
  }
  if (!templateId) return []
  const siblings = await prisma.document.findMany({
    where: { workspaceId, templateId, id: { not: identity.documentId }, status: { notIn: ["received", "queued", "processing"] } },
    select: { id: true, reviewedData: true },
    take: 500,
  })
  const map = Object.values(CHECK_FIELD_MAPS).find((candidate) => candidate.supplier && candidate.invoiceNumber && candidate.total)
  if (!map) return []
  const others: DocumentIdentity[] = siblings.map((sibling) => {
    const values = (sibling.reviewedData ?? {}) as Record<string, unknown>
    return { documentId: sibling.id, supplier: asString(values[map.supplier as string]), invoiceNumber: asString(values[map.invoiceNumber as string]), total: asNumber(values[map.total as string]), currencyCode: identity.currencyCode }
  })
  const result = findNearDuplicate(identity, others)
  return result ? [result] : []
}

/** A document is a suspicious resubmission when the same supplier + invoice number was already
 * rejected once in this workspace's review history — someone re-sending a bill after being told
 * no, whether by mistake or on purpose, is exactly the pattern a person should see, not silently
 * re-process. */
async function checkSuspiciousResubmission(workspaceId: string, documentId: string, identity: DocumentIdentity): Promise<CheckResult | null> {
  if (!identity.supplier || !identity.invoiceNumber) return null
  // Matching JSON field values case-insensitively per template is exactly the per-template
  // mapping problem CHECK_FIELD_MAPS already solves once — reusing it in application code avoids
  // a second, JSON-path dialect of the same logic in raw SQL. The candidate set is capped, not
  // exhaustive: a workspace with an unbounded rejection history is a real edge case, but scanning
  // the 200 most recent rejections is more than enough to catch a resubmission of something
  // recently rejected, which is the case this check exists for.
  const rejectedTasks = await prisma.reviewTask.findMany({
    where: { workspaceId, status: "rejected", documentId: { not: documentId } },
    select: { documentId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
    distinct: ["documentId"],
  })
  if (!rejectedTasks.length) return null

  const rejectedDocuments = await prisma.document.findMany({
    where: { id: { in: rejectedTasks.map((task) => task.documentId) } },
    select: { id: true, reviewedData: true, template: { select: { code: true } } },
  })
  const supplier = identity.supplier.trim().toLowerCase()
  const invoiceNumber = identity.invoiceNumber.trim().toLowerCase()
  const match = rejectedDocuments.find((candidate) => {
    const map = candidate.template ? CHECK_FIELD_MAPS[candidate.template.code] : null
    if (!map?.supplier || !map.invoiceNumber) return false
    const values = (candidate.reviewedData ?? {}) as Record<string, unknown>
    return asString(values[map.supplier])?.trim().toLowerCase() === supplier && asString(values[map.invoiceNumber])?.trim().toLowerCase() === invoiceNumber
  })
  if (!match) return null
  return { checkCode: "suspicious_resubmission", status: "warn", message: "Same supplier and invoice number as a document rejected in a previous review.", detail: { rejectedDocumentId: match.id } }
}

async function siblingStatementPeriods(workspaceId: string, templateId: string | null, documentId: string, accountNumber: string, map: CheckFieldMap) {
  if (!templateId || !map.periodStart || !map.periodEnd || !map.accountNumber) return []
  const siblings = await prisma.document.findMany({
    where: { workspaceId, templateId, status: { notIn: ["received", "queued", "processing"] } },
    select: { id: true, reviewedData: true },
    take: 500,
  })
  return siblings
    .map((sibling) => {
      const values = (sibling.reviewedData ?? {}) as Record<string, unknown>
      if (asString(values[map.accountNumber as string]) !== accountNumber) return null
      const periodStart = asDate(values[map.periodStart as string])
      const periodEnd = asDate(values[map.periodEnd as string])
      return periodStart && periodEnd ? { periodStart, periodEnd } : null
    })
    .filter((period): period is { periodStart: Date; periodEnd: Date } => period !== null)
}
