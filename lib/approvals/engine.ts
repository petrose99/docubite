/** Pure decision logic for a ReviewTask attached to an ApprovalWorkflow (Dext-parity Phase 3
 * WP3.1). Deliberately has no Prisma import — models/review-tasks.ts loads the workflow's stages
 * and the task's currentStageIndex, calls these, and persists whatever comes back, the same split
 * as lib/bank-match/matcher.ts (pure scoring) vs models/bank-matches.ts (persistence). */

export type WorkflowStageInput = { stageIndex: number; requireOwner: boolean; name: string }

/** Only role gating exists — there is no per-stage named-approver list (see the ApprovalWorkflow
 * schema comment for why: WorkspaceRole is just "owner" | "member", nothing richer to key one on).
 * A plain member can decide any stage that doesn't require an owner. */
export function canDecideStage(input: { stage: WorkflowStageInput; actorRole: "owner" | "member" }): boolean {
  return !input.stage.requireOwner || input.actorRole === "owner"
}

export type StageDecisionResult =
  | { outcome: "advance"; nextStageIndex: number }
  | { outcome: "approved" }
  | { outcome: "rejected" }

/** A rejection at any stage is terminal regardless of how many stages remain — approvals are not
 * negotiable back and forth here, only a fresh review task (or workflow restart) starts over. An
 * approval either moves to the next stage index or, once the last stage clears, resolves the task. */
export function decideStage(input: { stages: WorkflowStageInput[]; currentStageIndex: number; decision: "approve" | "reject" }): StageDecisionResult {
  if (input.decision === "reject") return { outcome: "rejected" }
  const nextStageIndex = input.currentStageIndex + 1
  if (nextStageIndex >= input.stages.length) return { outcome: "approved" }
  return { outcome: "advance", nextStageIndex }
}

/** Looks up the stage a task is currently sitting at. Null if the index doesn't correspond to any
 * stage — shouldn't happen in practice (currentStageIndex only ever moves forward one at a time
 * from 0), but callers must not assume `.find` succeeds since a workflow's stages could in theory
 * be edited out from under an in-flight task. */
export function findCurrentStage(stages: WorkflowStageInput[], currentStageIndex: number): WorkflowStageInput | null {
  return stages.find((stage) => stage.stageIndex === currentStageIndex) ?? null
}
