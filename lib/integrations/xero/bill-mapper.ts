import type { NormalizedBill } from "@/lib/integration-bill-mapping"

/** Builds the exact request body for `POST https://api.xero.com/api.xro/2.0/Invoices` with
 * `Type: "ACCPAY"` (Xero's accounts-payable bill). `contactId` and `accountCode` are resolved by the
 * caller (find-or-create contact, and the connection's configured default expense account) before
 * mapping. Every line item is coded to the same `accountCode`, per scope. */
export function toXeroBillBody(bill: NormalizedBill, contactId: string, accountCode: string) {
  return {
    Type: "ACCPAY",
    Contact: { ContactID: contactId },
    ...(bill.issueDate ? { Date: bill.issueDate } : {}),
    ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
    ...(bill.referenceNumber ? { InvoiceNumber: bill.referenceNumber } : {}),
    LineItems: bill.lineItems.map((item) => ({
      Description: item.description,
      Quantity: item.quantity || 1,
      UnitAmount: item.unitPrice,
      AccountCode: accountCode,
    })),
    Status: "AUTHORISED",
  }
}
