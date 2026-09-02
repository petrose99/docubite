import { describe, expect, it } from "vitest"
import { computeHealthScore, projectHealthScore, scoreBucket } from "@/lib/health/score"

describe("computeHealthScore", () => {
  const defaultWeights = { a: 1, b: 1, c: 2 }

  it("weights checks by their configured or default weight", () => {
    const result = computeHealthScore(
      [
        { checkCode: "a", applicableCount: 10, failedCount: 0 }, // score 100, weight 1
        { checkCode: "c", applicableCount: 10, failedCount: 10 }, // score 0, weight 2
      ],
      [],
      defaultWeights,
    )
    // (100*1 + 0*2) / (1+2) = 33.33
    expect(result.score).toBeCloseTo(33.33, 1)
  })

  it("falls back to defaultWeight when no config row exists, and to the check's default when weight is null", () => {
    const result = computeHealthScore(
      [{ checkCode: "a", applicableCount: 4, failedCount: 1 }],
      [{ checkCode: "a", enabled: true, weight: null }],
      defaultWeights,
    )
    expect(result.breakdown[0].weight).toBe(1)
    expect(result.score).toBeCloseTo(75, 5)
  })

  it("uses a config override's explicit weight when set", () => {
    const result = computeHealthScore(
      [{ checkCode: "a", applicableCount: 4, failedCount: 0 }],
      [{ checkCode: "a", enabled: true, weight: 5 }],
      defaultWeights,
    )
    expect(result.breakdown[0].weight).toBe(5)
  })

  it("excludes a check disabled via config from the average", () => {
    const result = computeHealthScore(
      [
        { checkCode: "a", applicableCount: 10, failedCount: 10 }, // would drag score to 0
        { checkCode: "b", applicableCount: 10, failedCount: 0 },
      ],
      [{ checkCode: "a", enabled: false, weight: null }],
      defaultWeights,
    )
    expect(result.score).toBe(100)
    expect(result.breakdown.map((e) => e.checkCode)).toEqual(["b"])
  })

  it("skips a check with zero applicable items rather than scoring it 0 or 100", () => {
    const result = computeHealthScore(
      [
        { checkCode: "a", applicableCount: 0, failedCount: 0 },
        { checkCode: "b", applicableCount: 10, failedCount: 5 },
      ],
      [],
      defaultWeights,
    )
    expect(result.breakdown.map((e) => e.checkCode)).toEqual(["b"])
    expect(result.score).toBeCloseTo(50, 5)
  })

  it("returns a null score, not 0, when every check is skipped or disabled", () => {
    const result = computeHealthScore([{ checkCode: "a", applicableCount: 0, failedCount: 0 }], [], defaultWeights)
    expect(result.score).toBeNull()
    expect(result.bucket).toBeNull()
  })

  it("ignores a check with no known default weight and no override", () => {
    const result = computeHealthScore(
      [{ checkCode: "unknown", applicableCount: 10, failedCount: 10 }],
      [],
      defaultWeights,
    )
    expect(result.score).toBeNull()
  })
})

describe("scoreBucket", () => {
  it("is good at 71 and above", () => {
    expect(scoreBucket(71)).toBe("good")
    expect(scoreBucket(100)).toBe("good")
  })

  it("is warning at 36 through 70", () => {
    expect(scoreBucket(70)).toBe("warning")
    expect(scoreBucket(36)).toBe("warning")
  })

  it("is bad at 35 and below", () => {
    expect(scoreBucket(35)).toBe("bad")
    expect(scoreBucket(0)).toBe("bad")
  })
})

describe("projectHealthScore", () => {
  const defaultWeights = { tax_mismatch: 2, missing_tax: 1, submission_volume: 0 }

  it("matches computeHealthScore's own numbers for both the current and projected run", () => {
    const currentInputs = [{ checkCode: "tax_mismatch", applicableCount: 10, failedCount: 0 }]
    const projectedInputs = [{ checkCode: "tax_mismatch", applicableCount: 12, failedCount: 2 }]
    const result = projectHealthScore(currentInputs, projectedInputs, [], defaultWeights)
    expect(result.currentScore).toBeCloseTo(computeHealthScore(currentInputs, [], defaultWeights).score as number)
    expect(result.projectedScore).toBeCloseTo(computeHealthScore(projectedInputs, [], defaultWeights).score as number)
    expect(result.projectedScore as number).toBeLessThan(result.currentScore as number)
  })

  it("names a risk factor for a check whose failedCount grew in the projection", () => {
    const currentInputs = [{ checkCode: "tax_mismatch", applicableCount: 10, failedCount: 1 }]
    const projectedInputs = [{ checkCode: "tax_mismatch", applicableCount: 13, failedCount: 4 }]
    const result = projectHealthScore(currentInputs, projectedInputs, [], defaultWeights)
    expect(result.riskFactors).toHaveLength(1)
    expect(result.riskFactors[0]).toContain("3 pending document")
    expect(result.riskFactors[0]).toContain("tax mismatch")
  })

  it("produces no risk factors when the projection adds nothing new", () => {
    const inputs = [{ checkCode: "tax_mismatch", applicableCount: 10, failedCount: 1 }]
    const result = projectHealthScore(inputs, inputs, [], defaultWeights)
    expect(result.riskFactors).toEqual([])
  })

  it("ignores growth in a weight-0 check when deriving risk factors", () => {
    const currentInputs = [{ checkCode: "submission_volume", applicableCount: 1, failedCount: 0 }]
    const projectedInputs = [{ checkCode: "submission_volume", applicableCount: 1, failedCount: 1 }]
    const result = projectHealthScore(currentInputs, projectedInputs, [], defaultWeights)
    expect(result.riskFactors).toEqual([])
    expect(result.currentScore).toBeNull() // no scored checks at all
  })

  it("names improvement actions from the current run's own failures, independent of the projection", () => {
    const currentInputs = [{ checkCode: "missing_tax", applicableCount: 5, failedCount: 2 }]
    const projectedInputs = [{ checkCode: "missing_tax", applicableCount: 5, failedCount: 2 }]
    const result = projectHealthScore(currentInputs, projectedInputs, [], defaultWeights)
    expect(result.improvementActions).toHaveLength(1)
    expect(result.improvementActions[0]).toContain("2 already-pushed")
  })

  it("falls back to a humanized checkCode for a label with no dedicated phrasing", () => {
    const weights = { unknown_check: 1 }
    const currentInputs = [{ checkCode: "unknown_check", applicableCount: 5, failedCount: 0 }]
    const projectedInputs = [{ checkCode: "unknown_check", applicableCount: 5, failedCount: 3 }]
    const result = projectHealthScore(currentInputs, projectedInputs, [], weights)
    expect(result.riskFactors[0]).toContain("unknown check")
  })

  it("caps riskFactors and improvementActions at 5, ranked by impact", () => {
    const weights = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`check_${i}`, 1]))
    const currentInputs = Array.from({ length: 8 }, (_, i) => ({ checkCode: `check_${i}`, applicableCount: 20, failedCount: i }))
    // Delta (projected - current) grows with i too, so check_7 has both the largest current
    // failedCount (7) and the largest delta (7) — distinct from a constant-delta setup, which
    // would leave every check tied on impact and the ranking untestable.
    const projectedInputs = Array.from({ length: 8 }, (_, i) => ({ checkCode: `check_${i}`, applicableCount: 20, failedCount: i + i }))
    const result = projectHealthScore(currentInputs, projectedInputs, [], weights)
    expect(result.riskFactors).toHaveLength(5)
    expect(result.improvementActions).toHaveLength(5)
    // check_7 has the largest delta (7) and the largest current failedCount (7) — must be first in both.
    expect(result.riskFactors[0]).toContain("check 7")
    expect(result.improvementActions[0]).toContain("check 7")
  })

  it("returns null scores when nothing is applicable in either run", () => {
    const result = projectHealthScore([], [], [], defaultWeights)
    expect(result.currentScore).toBeNull()
    expect(result.projectedScore).toBeNull()
    expect(result.riskFactors).toEqual([])
    expect(result.improvementActions).toEqual([])
  })
})
