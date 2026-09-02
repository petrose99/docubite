/** Flags a growing accounting review queue: more than 20 open/in_review tasks, or any one of them
 * sitting for more than 7 days. One workspace-wide finding (there is exactly one "is the backlog
 * healthy" question per run), not one per task — unlike every other Phase A check, which is
 * document-scoped. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const REVIEW_BACKLOG_OPEN_THRESHOLD = 20
export const REVIEW_BACKLOG_AGE_THRESHOLD_DAYS = 7

function daysOld(createdAt: Date, now: Date): number {
  return (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
}

export const reviewBacklogCheck: CheckDefinition = {
  code: "review_backlog",
  name: "Review backlog",
  category: "pipeline",
  defaultWeight: 1.5,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const openTasks = ctx.reviewTasks.filter((task) => task.status === "open" || task.status === "in_review")
    // Exactly one applicable item: "is this workspace's review backlog healthy right now". Always
    // applicable, even with zero open tasks — a workspace with no review queue at all is a clean
    // pass, not a check with nothing to say.
    const applicableCount = 1

    const oldestAgeDays = openTasks.reduce((max, task) => Math.max(max, daysOld(task.createdAt, ctx.dateRange.to)), 0)
    const overThreshold = openTasks.length > REVIEW_BACKLOG_OPEN_THRESHOLD
    const hasStaleTask = oldestAgeDays > REVIEW_BACKLOG_AGE_THRESHOLD_DAYS

    if (!overThreshold && !hasStaleTask) return { findings: [], applicableCount }

    const reasons: string[] = []
    if (overThreshold) reasons.push(`${openTasks.length} documents are waiting for review`)
    if (hasStaleTask) reasons.push(`the oldest has been open for ${Math.floor(oldestAgeDays)} days`)

    return {
      applicableCount,
      findings: [{
        checkCode: "review_backlog",
        category: "pipeline",
        severity: "warning",
        title: "Review queue is backing up",
        description: `${reasons.join("; ")}.`,
        documentId: null,
        suggestedAction: "open_review_queue",
        suggestedActionPayload: { href: "review" },
        affectedCount: openTasks.length,
      }],
    }
  },
}
