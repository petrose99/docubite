import { describe, expect, it } from "vitest"
import { canDecideStage, decideStage, findCurrentStage, type WorkflowStageInput } from "@/lib/approvals/engine"

const stages: WorkflowStageInput[] = [
  { stageIndex: 0, requireOwner: false, name: "First pass" },
  { stageIndex: 1, requireOwner: true, name: "Owner sign-off" },
  { stageIndex: 2, requireOwner: false, name: "Final check" },
]

describe("decideStage", () => {
  it("advances to the next stage on approval when stages remain", () => {
    expect(decideStage({ stages, currentStageIndex: 0, decision: "approve" })).toEqual({ outcome: "advance", nextStageIndex: 1 })
  })

  it("resolves as approved once the last stage clears", () => {
    expect(decideStage({ stages, currentStageIndex: 2, decision: "approve" })).toEqual({ outcome: "approved" })
  })

  it("rejects immediately regardless of how many stages remain", () => {
    expect(decideStage({ stages, currentStageIndex: 0, decision: "reject" })).toEqual({ outcome: "rejected" })
    expect(decideStage({ stages, currentStageIndex: 2, decision: "reject" })).toEqual({ outcome: "rejected" })
  })

  it("treats a single-stage workflow's approval as resolving immediately", () => {
    const single: WorkflowStageInput[] = [{ stageIndex: 0, requireOwner: false, name: "Only stage" }]
    expect(decideStage({ stages: single, currentStageIndex: 0, decision: "approve" })).toEqual({ outcome: "approved" })
  })
})

describe("canDecideStage", () => {
  it("lets any role decide a stage that doesn't require an owner", () => {
    expect(canDecideStage({ stage: stages[0], actorRole: "member" })).toBe(true)
    expect(canDecideStage({ stage: stages[0], actorRole: "owner" })).toBe(true)
  })

  it("only lets an owner decide a stage that requires one", () => {
    expect(canDecideStage({ stage: stages[1], actorRole: "member" })).toBe(false)
    expect(canDecideStage({ stage: stages[1], actorRole: "owner" })).toBe(true)
  })
})

describe("findCurrentStage", () => {
  it("finds the stage matching the given index", () => {
    expect(findCurrentStage(stages, 1)).toEqual({ stageIndex: 1, requireOwner: true, name: "Owner sign-off" })
  })

  it("returns null when no stage matches", () => {
    expect(findCurrentStage(stages, 5)).toBeNull()
  })
})
