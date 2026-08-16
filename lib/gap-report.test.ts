import { collectIssues, findPeriodGaps, groupDocuments, type ReportDoc } from "@/lib/gap-report"
import { describe, expect, it } from "vitest"

const doc = (over: Partial<ReportDoc>): ReportDoc => ({ id: "x", filename: "x.pdf", shapeId: null, docType: "", entity: "", period: "", status: "ready_for_review", confidence: null, ...over })

describe("groupDocuments", () => {
  it("groups by shape when present, else by doc type and entity", () => {
    const groups = groupDocuments([
      doc({ id: "1", shapeId: "s1", period: "2026-01" }),
      doc({ id: "2", shapeId: "s1", period: "2026-02" }),
      doc({ id: "3", docType: "Invoice", entity: "Acme" }),
      doc({ id: "4", docType: "invoice", entity: "acme" }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].documentIds).toEqual(["1", "2"])
    expect(groups[0].periods).toEqual(["2026-01", "2026-02"])
    // Case-insensitive label key folds "Invoice/Acme" and "invoice/acme" together.
    expect(groups[1].documentIds).toEqual(["3", "4"])
  })
})

describe("findPeriodGaps", () => {
  it("reports the missing months in a monthly series, across a year boundary", () => {
    expect(findPeriodGaps(["2025-11", "2025-12", "2026-02"])).toEqual(["2026-01"])
  })

  it("finds multiple interior gaps", () => {
    expect(findPeriodGaps(["2026-01", "2026-04", "2026-06"])).toEqual(["2026-02", "2026-03", "2026-05"])
  })

  it("stays silent below three data points or with unparseable periods", () => {
    expect(findPeriodGaps(["2026-01", "2026-03"])).toEqual([])
    expect(findPeriodGaps(["2026-01", "n/a", "garbage"])).toEqual([])
  })
})

describe("collectIssues", () => {
  it("turns missing, conflicting, and failed states into plain lines", () => {
    const issues = collectIssues([
      doc({ id: "1", filename: "acme.pdf", confidence: { missingRequiredFields: ["total"] } }),
      doc({ id: "2", filename: "globex.pdf", confidence: { conflictingFields: ["invoice_number"] } }),
      doc({ id: "3", filename: "broken.pdf", status: "failed" }),
      doc({ id: "4", filename: "clean.pdf", confidence: { missingRequiredFields: [] } }),
    ])
    expect(issues.map((issue) => issue.message)).toEqual([
      "acme.pdf: total missing",
      "globex.pdf: invoice_number has conflicting reads",
      "broken.pdf: extraction failed",
    ])
  })
})
