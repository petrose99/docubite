// Deliberately NOT a "use server" module, matching every other models/*.ts helper — but unlike
// most of them, this one has no per-request caller to gate access: it is only ever invoked from
// the internal job-drain route (app/api/internal/jobs/process/route.ts), which is itself
// authenticated by the worker secret, not a signed-in user. There is no workspaceId argument
// anywhere here on purpose — a reminder sweep is cross-workspace by nature.
import config from "@/lib/config"
import { sendReminderEmail } from "@/lib/email"
import { isReminderDue } from "@/lib/reminders/engine"
import { prisma } from "@/lib/db"
import { unscoped } from "@/lib/workspace-scope"

/** Everyone a reminder about this item should go to: the assignee if one is set, otherwise every
 * workspace owner (there is no "reviewer" role to target more narrowly — see the same reasoning
 * in ApprovalWorkflowStage's own doc-comment). Owners of a workspace with no assignee are the
 * fallback because *someone* has to be nudged, and an unassigned task is everyone's responsibility
 * until it isn't. */
async function resolveRecipients(workspaceId: string, assigneeEmail: string | null): Promise<string[]> {
  if (assigneeEmail) return [assigneeEmail]
  const owners = await unscoped(() => prisma.workspaceMember.findMany({
    where: { workspaceId, role: "owner" },
    select: { user: { select: { email: true } } },
  }))
  return owners.map((owner) => owner.user.email).filter((email): email is string => Boolean(email))
}

/** Every stage-gated decision (see lib/approvals/engine.ts) defers to whichever owners are on the
 * workspace when the current stage requires one — same reasoning as an unassigned ReviewTask,
 * just applied to ExpenseClaim, which has no assignee concept at all today. */
async function resolveOwnerRecipients(workspaceId: string): Promise<string[]> {
  return resolveRecipients(workspaceId, null)
}

async function sendReviewTaskReminders(now: Date) {
  const candidates = await unscoped(() => prisma.reviewTask.findMany({
    where: { status: { in: ["open", "in_review"] } },
    select: {
      id: true, workspaceId: true, createdAt: true, lastReminderAt: true,
      document: { select: { filename: true } },
      assignee: { select: { email: true } },
    },
  }))

  let sent = 0
  for (const task of candidates) {
    if (!isReminderDue({ pendingSince: task.createdAt, lastReminderAt: task.lastReminderAt, now })) continue
    const recipients = await resolveRecipients(task.workspaceId, task.assignee?.email ?? null)
    if (!recipients.length) continue
    const actionUrl = `${config.app.baseURL}/workspaces/${task.workspaceId}/review/${task.id}`
    // One item's send failure (an unconfigured RESEND_API_KEY, a bounced address, Resend being
    // briefly down) must not abort the sweep for every other candidate, and must not stamp
    // lastReminderAt on a reminder nobody actually received — the next sweep just retries it.
    try {
      await Promise.all(recipients.map((to) => sendReminderEmail({
        to, subject: `Waiting on your review: ${task.document.filename}`,
        heading: "A document is waiting on your review",
        body: `${task.document.filename} has been in the review queue for a while and needs a decision.`,
        actionUrl, actionLabel: "Review it",
      })))
      await unscoped(() => prisma.reviewTask.update({ where: { id: task.id }, data: { lastReminderAt: now } }))
      sent++
    } catch (error) {
      console.error(`[reminders] failed to send review-task reminder for ${task.id}:`, error instanceof Error ? error.message : error)
    }
  }
  return sent
}

async function sendExpenseClaimReminders(now: Date) {
  const candidates = await unscoped(() => prisma.expenseClaim.findMany({
    where: { status: "submitted", submittedAt: { not: null } },
    select: { id: true, workspaceId: true, submittedAt: true, lastReminderAt: true, title: true },
  }))

  let sent = 0
  for (const claim of candidates) {
    if (!isReminderDue({ pendingSince: claim.submittedAt!, lastReminderAt: claim.lastReminderAt, now })) continue
    const recipients = await resolveOwnerRecipients(claim.workspaceId)
    if (!recipients.length) continue
    const actionUrl = `${config.app.baseURL}/workspaces/${claim.workspaceId}/expenses`
    const label = claim.title || "An expense claim"
    try {
      await Promise.all(recipients.map((to) => sendReminderEmail({
        to, subject: `Waiting on your decision: ${label}`,
        heading: "An expense claim is waiting on you",
        body: `${label} has been submitted and needs a decision.`,
        actionUrl, actionLabel: "Review it",
      })))
      await unscoped(() => prisma.expenseClaim.update({ where: { id: claim.id }, data: { lastReminderAt: now } }))
      sent++
    } catch (error) {
      console.error(`[reminders] failed to send expense-claim reminder for ${claim.id}:`, error instanceof Error ? error.message : error)
    }
  }
  return sent
}

/** Called from every hit of the internal job-drain route, same as drainWebhookDeliveries and
 * drainIntegrationPushes — cheap and idempotent when nothing is due, since isReminderDue is what
 * actually decides whether any given item sends anything. `now` is a parameter rather than read
 * internally so a test can pin it, matching the pattern of the rest of this file's date math. */
export async function sendDueReminders(now: Date = new Date()) {
  const [reviewTasks, expenseClaims] = await Promise.all([sendReviewTaskReminders(now), sendExpenseClaimReminders(now)])
  return { reviewTasks, expenseClaims }
}
