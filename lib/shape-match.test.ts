import { buildShapeSignature, matchShape, scoreShapeMatch, type ShapeSignature } from "@/lib/shape-match"
import { describe, expect, it } from "vitest"

describe("buildShapeSignature", () => {
  it("normalises labels and keeps the header tokens in reading order", () => {
    const sig = buildShapeSignature({ firstPageText: "ACME Corp Invoice invoice number 1001 total due", docType: "Invoice", entity: "ACME Corp" })
    expect(sig.docType).toBe("invoice")
    expect(sig.entity).toBe("acme corp")
    expect(sig.headTokens.slice(0, 3)).toEqual(["acme", "corp", "invoice"])
    // "invoice" appears twice in the text but heads are deduped, so "number" follows it directly.
    expect(sig.headTokens[3]).toBe("number")
  })

  it("ranks the most frequent words first and drops short ones", () => {
    const sig = buildShapeSignature({ firstPageText: "total total total ab cd invoice" })
    expect(sig.tokens[0]).toBe("total")
    expect(sig.tokens).not.toContain("ab")
  })
})

describe("scoreShapeMatch", () => {
  it("scores an identical signature as 1", () => {
    const sig = buildShapeSignature({ firstPageText: "acme corp invoice number total due", docType: "invoice", entity: "acme" })
    expect(scoreShapeMatch(sig, sig)).toBeCloseTo(1, 5)
  })
})

const tokens = (n: number, from = 1) => Array.from({ length: n }, (_, index) => `t${from + index}`)
const heads = (n: number, from = 1) => Array.from({ length: n }, (_, index) => `h${from + index}`)

describe("matchShape", () => {
  const invoice = "Acme Corp Invoice number INV-1 date 2026-01 subtotal tax total widget gadget services rendered payment terms net thirty"

  it("matches a noisy re-scan of the same document", () => {
    const candidate = { id: "s1", signature: buildShapeSignature({ firstPageText: invoice, docType: "invoice", entity: "acme corp" }) }
    const probe = buildShapeSignature({ firstPageText: invoice.replace("widget", "widgets").replace("gadget", "gadgets"), docType: "invoice", entity: "acme corp" })
    expect(matchShape([candidate], probe)?.id).toBe("s1")
  })

  it("rejects a document of a different kind and entity", () => {
    const candidate = { id: "s1", signature: buildShapeSignature({ firstPageText: invoice, docType: "invoice", entity: "acme corp" }) }
    const other = buildShapeSignature({ firstPageText: "Global Bank monthly statement account balance transactions deposits withdrawals interest fees charged", docType: "bank statement", entity: "global bank" })
    expect(matchShape([candidate], other)).toBeNull()
  })

  it("returns null when two candidates are too close to choose between", () => {
    const signature = buildShapeSignature({ firstPageText: invoice, docType: "invoice", entity: "acme corp" })
    const probe = buildShapeSignature({ firstPageText: invoice, docType: "invoice", entity: "acme corp" })
    expect(matchShape([{ id: "s1", signature }, { id: "s2", signature }], probe)).toBeNull()
  })

  it("holds a label-less probe to a higher bar than a labelled one", () => {
    const sigA: ShapeSignature = { tokens: tokens(10), headTokens: heads(10), docType: "invoice", entity: "acme" }
    const labelled: ShapeSignature = { tokens: [...tokens(8), "t11", "t12"], headTokens: [...heads(8), "h20", "h21"], docType: "invoice", entity: "acme" }
    const labelless: ShapeSignature = { ...labelled, docType: "", entity: "" }
    // Same layout overlap; only the classification labels differ. The labelled probe clears 0.62,
    // the label-less one does not clear the raised 0.68 bar.
    expect(matchShape([{ id: "s1", signature: sigA }], labelled)?.id).toBe("s1")
    expect(matchShape([{ id: "s1", signature: sigA }], labelless)).toBeNull()
  })
})
