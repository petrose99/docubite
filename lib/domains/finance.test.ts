import { describe, expect, it } from "vitest"
import { FINANCE_OPTIONAL_TEMPLATES, FINANCE_TEMPLATES } from "@/lib/domains/finance"
import { parseTemplateFields } from "@/lib/document-templates"

describe("FINANCE_TEMPLATES (seeded core)", () => {
  it("seeds exactly invoice, receipt, expense_receipt and generic", () => {
    expect(FINANCE_TEMPLATES.map((template) => template.code)).toEqual(["invoice", "receipt", "expense_receipt", "generic"])
  })

  it("expense_receipt carries the fields a fast-categorization worksheet needs, none hardcoding a category or tax-code vocabulary", () => {
    const template = FINANCE_TEMPLATES.find((t) => t.code === "expense_receipt")!
    const fields = parseTemplateFields(template.fields)
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(["merchant", "purchase_date", "total", "tax_code", "category", "payment_method"]))
    expect(template.multiRow).toBe(false)
    const category = fields.find((f) => f.key === "category")!
    const taxCode = fields.find((f) => f.key === "tax_code")!
    // "not hardcoded": the instruction must not name a specific category or rate — the real
    // vocabulary lives in a workspace's TaxProfile (lib/tax/regions.ts), read at check time (WP12).
    for (const field of [category, taxCode]) {
      expect(field.instruction.toLowerCase()).not.toMatch(/\b(15%|20%|vat 15|meals|travel|office supplies)\b/)
    }
  })
})

describe("FINANCE_OPTIONAL_TEMPLATES", () => {
  it("offers exactly the four add-on worksheets", () => {
    expect(FINANCE_OPTIONAL_TEMPLATES.map((template) => template.code).sort()).toEqual(
      ["bank_statement", "purchase_order", "remittance_advice", "supplier_statement"].sort(),
    )
  })

  it("none of the optional codes collide with a seeded one", () => {
    const seeded = new Set(FINANCE_TEMPLATES.map((template) => template.code))
    for (const template of FINANCE_OPTIONAL_TEMPLATES) expect(seeded.has(template.code)).toBe(false)
  })

  it("every optional template's fields parse successfully", () => {
    for (const template of FINANCE_OPTIONAL_TEMPLATES) expect(() => parseTemplateFields(template.fields)).not.toThrow()
  })

  it("bank_statement balances opening (first-page) against closing (last-page) merge strategies", () => {
    const bankStatement = FINANCE_OPTIONAL_TEMPLATES.find((t) => t.code === "bank_statement")!
    const fields = parseTemplateFields(bankStatement.fields)
    expect(fields.find((f) => f.key === "opening_balance")?.mergeStrategy).toBe("first")
    expect(fields.find((f) => f.key === "closing_balance")?.mergeStrategy).toBe("last")
    const transactions = fields.find((f) => f.key === "transactions")!
    expect(transactions.type).toBe("array")
    expect(transactions.itemFields?.map((f) => f.key)).toEqual(["transaction_date", "description", "debit", "credit", "running_balance"])
  })

  it("remittance_advice allocates a payment across invoices as an array", () => {
    const remittance = FINANCE_OPTIONAL_TEMPLATES.find((t) => t.code === "remittance_advice")!
    const fields = parseTemplateFields(remittance.fields)
    const allocations = fields.find((f) => f.key === "allocations")!
    expect(allocations.type).toBe("array")
    expect(allocations.itemFields?.map((f) => f.key)).toEqual(["invoice_number", "amount"])
  })

  it("purchase_order requires a PO number and a supplier", () => {
    const po = FINANCE_OPTIONAL_TEMPLATES.find((t) => t.code === "purchase_order")!
    const fields = parseTemplateFields(po.fields)
    expect(fields.find((f) => f.key === "po_number")?.required).toBe(true)
    expect(fields.find((f) => f.key === "supplier")?.required).toBe(true)
  })

  it("supplier_statement closes on a running balance", () => {
    const statement = FINANCE_OPTIONAL_TEMPLATES.find((t) => t.code === "supplier_statement")!
    const fields = parseTemplateFields(statement.fields)
    expect(fields.find((f) => f.key === "closing_balance")?.mergeStrategy).toBe("last")
  })
})
