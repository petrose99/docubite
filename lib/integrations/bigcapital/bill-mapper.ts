import type { NormalizedBill } from "@/lib/integration-bill-mapping"

/** Builds the request body for `POST /api/bills`. `vendorId` and `itemId` are Bigcapital entity
 * ids, resolved by the caller (find-or-create vendor, and find-or-create a generic expense item for
 * the connection's configured default expense account — see client.ts's findOrCreateExpenseItem)
 * before mapping — pure JSON shaping, no network, matching the QuickBooks/Xero mappers' shape.
 * Bigcapital bill entries reference an Item, not an account directly (confirmed live: an entry with
 * no `item_id` is rejected as `isInt`/`isNotEmpty`), which is why an item has to exist first —
 * unlike QuickBooks/Xero, where a line codes straight to an account. Every line item uses the same
 * `itemId` (one default expense account per connection, no per-line mapping), matching the other
 * two providers' scope. Field/endpoint names here were verified against a live self-hosted
 * instance, not just documentation.
 *
 * Every entry is quantity 1 at rate = the line's `amount`, rather than the extracted
 * quantity/unitPrice pair — confirmed live that Bigcapital computes an entry's own total as
 * quantity × rate server-side, so posting the real quantity/unitPrice silently produces the WRONG
 * bill total whenever `amount` isn't exactly quantity × unitPrice (observed on a real invoice: two
 * lines' extracted `amount` didn't match their `unitPrice`, inflating the pushed bill by ~77%).
 * `amount` is the one number this app's own extraction and review UI treat as ground truth — the
 * same reason QuickBooks's mapper posts `Amount: item.amount` directly rather than a quantity/rate
 * pair — so it's what must reach the ledger, not a recomputation of it. */
export function toBigcapitalBillBody(bill: NormalizedBill, vendorId: string, itemId: string) {
  return {
    vendor_id: Number(vendorId),
    bill_date: bill.issueDate ?? new Date().toISOString().slice(0, 10),
    ...(bill.dueDate ? { due_date: bill.dueDate } : {}),
    ...(bill.referenceNumber ? { bill_number: bill.referenceNumber.slice(0, 50) } : {}),
    ...(bill.currencyCode ? { currency_code: bill.currencyCode } : {}),
    entries: bill.lineItems.map((item, index) => ({
      index: index + 1,
      item_id: Number(itemId),
      description: item.description,
      quantity: 1,
      rate: item.amount,
    })),
  }
}
