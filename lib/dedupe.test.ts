import { findDuplicates, nearDupeScore, shingleSet, type DedupeDoc } from "@/lib/dedupe"
import { describe, expect, it } from "vitest"

const base = "the quick brown fox jumps over the lazy dog again while the clever cat watches quietly from the fence post nearby"

describe("shingleSet", () => {
  it("produces 5-word shingles", () => {
    const set = shingleSet("one two three four five six")
    expect(set.has("one two three four five")).toBe(true)
    expect(set.has("two three four five six")).toBe(true)
    expect(set.size).toBe(2)
  })

  it("treats a short document as a single shingle", () => {
    expect([...shingleSet("just three words")]).toEqual(["just three words"])
  })
})

describe("nearDupeScore", () => {
  it("is 1 for identical sets and 0 when disjoint", () => {
    expect(nearDupeScore(shingleSet(base), shingleSet(base))).toBe(1)
    expect(nearDupeScore(shingleSet("alpha beta gamma delta epsilon"), shingleSet("one two three four five"))).toBe(0)
  })
})

describe("findDuplicates", () => {
  const doc = (over: Partial<DedupeDoc>): DedupeDoc => ({ id: "x", filename: "x.pdf", sha256: "h", text: base, period: "2026-01", ...over })

  it("flags byte-identical files as exact copies", () => {
    const pairs = findDuplicates([doc({ id: "1", filename: "a.pdf", sha256: "same" }), doc({ id: "2", filename: "b.pdf", sha256: "same", text: "totally different words here that do not overlap at all" })])
    expect(pairs).toEqual([{ a: "1", b: "2", aFilename: "a.pdf", bFilename: "b.pdf", kind: "exact", score: 1 }])
  })

  it("flags a near-identical re-scan when the periods agree", () => {
    const pairs = findDuplicates([doc({ id: "1", filename: "a.pdf", sha256: "h1" }), doc({ id: "2", filename: "b.pdf", sha256: "h2" })])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ a: "1", b: "2", kind: "near" })
    expect(pairs[0].score).toBeGreaterThanOrEqual(0.92)
  })

  it("does not flag the same template across different periods as a duplicate", () => {
    const pairs = findDuplicates([doc({ id: "1", sha256: "h1", period: "2026-01" }), doc({ id: "2", sha256: "h2", period: "2026-02" })])
    expect(pairs).toEqual([])
  })

  it("still flags an exact copy even across different periods", () => {
    const pairs = findDuplicates([doc({ id: "1", sha256: "same", period: "2026-01" }), doc({ id: "2", sha256: "same", period: "2026-02" })])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].kind).toBe("exact")
  })
})
