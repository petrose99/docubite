import { parseTemplateFields } from "@/lib/document-templates"
import { diffExtractions, isEmptyDiff } from "@/lib/run-diff"
import { describe, expect, it } from "vitest"

const fields = parseTemplateFields([
  { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
  { key: "total", label: "Total", type: "number", required: false, instruction: "" },
  { key: "due_date", label: "Due date", type: "date", required: false, instruction: "" },
  { key: "line_items", label: "Line items", type: "array", required: false, instruction: "", itemFields: [
    { key: "description", label: "Description", type: "string", required: false, instruction: "" },
    { key: "amount", label: "Amount", type: "number", required: false, instruction: "" },
  ] },
])

describe("diffExtractions", () => {
  it("reports added, missing, and changed scalar fields", () => {
    const diff = diffExtractions(fields, { vendor: "Acme", total: 100 }, { vendor: "Acme", due_date: "2026-02-01", total: 120 })
    expect(diff.added).toEqual([{ key: "due_date", label: "Due date", after: "2026-02-01" }])
    expect(diff.missing).toEqual([])
    expect(diff.changed).toEqual([{ key: "total", label: "Total", before: 100, after: 120 }])
  })

  it("treats a trimmed-equal string as unchanged", () => {
    const diff = diffExtractions(fields, { vendor: "Acme " }, { vendor: "Acme" })
    expect(diff.changed).toEqual([])
  })

  it("counts line-item row and cell deltas position for position", () => {
    const prev = { line_items: [{ description: "A", amount: 1 }, { description: "B", amount: 2 }] }
    const next = { line_items: [{ description: "A", amount: 5 }, { description: "B", amount: 2 }, { description: "C", amount: 3 }] }
    const diff = diffExtractions(fields, prev, next)
    expect(diff.items).toEqual({ addedRows: 1, removedRows: 0, changedCells: 1 })
  })

  it("counts removed rows when the next run has fewer", () => {
    const diff = diffExtractions(fields, { line_items: [{ amount: 1 }, { amount: 2 }, { amount: 3 }] }, { line_items: [{ amount: 1 }] })
    expect(diff.items).toMatchObject({ addedRows: 0, removedRows: 2 })
  })

  it("gives a null items delta when the shape has no array field", () => {
    const scalarOnly = parseTemplateFields([{ key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" }])
    expect(diffExtractions(scalarOnly, { vendor: "A" }, { vendor: "B" }).items).toBeNull()
  })

  it("treats an empty previous extraction as everything added", () => {
    const diff = diffExtractions(fields, {}, { vendor: "Acme", total: 100 })
    expect(diff.added.map((entry) => entry.key)).toEqual(["vendor", "total"])
    expect(diff.changed).toEqual([])
  })
})

describe("isEmptyDiff", () => {
  it("is true only when nothing changed", () => {
    expect(isEmptyDiff(diffExtractions(fields, { vendor: "Acme", total: 1 }, { vendor: "Acme", total: 1 }))).toBe(true)
    expect(isEmptyDiff(diffExtractions(fields, { vendor: "Acme", total: 1 }, { vendor: "Acme", total: 2 }))).toBe(false)
  })
})
