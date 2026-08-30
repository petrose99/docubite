import { describe, expect, it } from "vitest"
import { diffSnapshotsForWriteback } from "./sheet-writeback"
import type { WorkbookSnapshot } from "@/models/spreadsheets"

const scalarCustom = (documentId: string, fieldKey: string) => ({ documentId, filename: "a.pdf", itemIndex: null, fieldKey, itemKey: null })
const itemCustom = (documentId: string, itemIndex: number, itemKey: string) => ({ documentId, filename: "a.pdf", itemIndex, fieldKey: "line_items", itemKey })

function snapshot(sheetId: string, cellData: Record<number, Record<number, unknown>>): WorkbookSnapshot {
  return { sheetOrder: [sheetId], sheets: { [sheetId]: { cellData } } }
}

describe("diffSnapshotsForWriteback", () => {
  it("reports a changed scalar cell", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    const newSnap = snapshot("s1", { 1: { 0: { v: "Acme Corp", custom: scalarCustom("doc1", "vendor") } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([
      { documentId: "doc1", fieldKey: "vendor", itemIndex: null, itemKey: null, newValue: "Acme Corp" },
    ])
  })

  it("reports a changed line-item cell", () => {
    const oldSnap = snapshot("s1", { 1: { 2: { v: 10, custom: itemCustom("doc1", 0, "amount") } } })
    const newSnap = snapshot("s1", { 1: { 2: { v: 25, custom: itemCustom("doc1", 0, "amount") } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([
      { documentId: "doc1", fieldKey: "line_items", itemIndex: 0, itemKey: "amount", newValue: 25 },
    ])
  })

  it("matches by provenance key across a row reorder, not position", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    // Same cell, now three rows further down — a sort moved it, the value did not change.
    const newSnap = snapshot("s1", { 4: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([])
  })

  it("skips a cell that now holds a formula", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    const newSnap = snapshot("s1", { 1: { 0: { v: "AI RESULT", f: "=AI(\"classify\")", custom: scalarCustom("doc1", "vendor") } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([])
  })

  it("does not write back a row ensureFileWorkbook just appended (no old counterpart)", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    const newSnap = snapshot("s1", {
      1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } },
      2: { 0: { v: "Globex", custom: scalarCustom("doc2", "vendor") } },
    })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([])
  })

  it("propagates null for a cell cleared but still present", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    const newSnap = snapshot("s1", { 1: { 0: { custom: scalarCustom("doc1", "vendor") } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([
      { documentId: "doc1", fieldKey: "vendor", itemIndex: null, itemKey: null, newValue: null },
    ])
  })

  it("does not blank a field whose row was deleted", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    const newSnap = snapshot("s1", {})
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([])
  })

  it("falls back to position when a retype drops the cell's custom payload", () => {
    const oldSnap = snapshot("s1", { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } })
    // Same (row, col), but the new cell is a plain retype with no custom at all.
    const newSnap = snapshot("s1", { 1: { 0: { v: "Acme Corp" } } })
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([
      { documentId: "doc1", fieldKey: "vendor", itemIndex: null, itemKey: null, newValue: "Acme Corp" },
    ])
  })

  it("ignores a worksheet deleted entirely", () => {
    const oldSnap: WorkbookSnapshot = { sheetOrder: ["s1", "s2"], sheets: {
      s1: { cellData: { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } } },
      s2: { cellData: { 1: { 0: { v: "Globex", custom: scalarCustom("doc2", "vendor") } } } },
    } }
    const newSnap: WorkbookSnapshot = { sheetOrder: ["s1"], sheets: {
      s1: { cellData: { 1: { 0: { v: "Acme", custom: scalarCustom("doc1", "vendor") } } } },
    } }
    expect(diffSnapshotsForWriteback(oldSnap, newSnap)).toEqual([])
  })
})
