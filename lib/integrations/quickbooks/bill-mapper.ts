import type { NormalizedBill } from "@/lib/integration-bill-mapping"

/** Builds the exact request body for `POST /v3/company/{realmId}/bill`. `vendorRef` and
 * `accountRef` are QuickBooks entity ids, resolved by the caller (find-or-create vendor, and the
 * connection's configured default expense account) before mapping — this function is pure JSON
 * shaping, no network. Every line item is coded to the same `accountRef` (scope: one default
 * expense account per connection, no per-line mapping). */
export function toQuickBooksBillBody(bill: NormalizedBill, vendorRef: string, accountRef: string) {
  return {
    VendorRef: { value: vendorRef },
    ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
    ...(bill.issueDate ? { TxnDate: bill.issueDate } : {}),
    ...(bill.referenceNumber ? { DocNumber: bill.referenceNumber.slice(0, 21) } : {}),
    TotalAmt: bill.total,
    Line: bill.lineItems.map((item) => ({
      Amount: item.amount,
      DetailType: "AccountBasedExpenseLineDetail",
      Description: item.description,
      AccountBasedExpenseLineDetail: { AccountRef: { value: accountRef } },
    })),
  }
}
