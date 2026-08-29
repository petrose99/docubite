/** Pure due-for-a-reminder logic (Dext-parity Phase 3 WP3.4), no Prisma import — same split as
 * lib/approvals/engine.ts and lib/bank-match/matcher.ts: models/reminders.ts loads the pending
 * ReviewTasks/ExpenseClaims and their timestamps, calls this, and only sends+stamps the ones it
 * says are due. */

/** How long an item sits pending before it earns its first reminder. 48h: long enough that a
 * same-day or next-morning decision never triggers one, short enough that "waiting a week" never
 * happens silently. */
export const REMINDER_STALE_HOURS = 48

/** Minimum gap between reminders for the same still-pending item, so a slow decision gets nudged
 * repeatedly rather than exactly once and then silence — but not more than once every few days. */
export const REMINDER_REPEAT_HOURS = 72

const MS_PER_HOUR = 60 * 60 * 1000

/** `pendingSince` is when the item entered the state a reminder makes sense for (a ReviewTask's
 * `createdAt`, an ExpenseClaim's `submittedAt`) — not `updatedAt`, which changes on every field
 * edit and would keep pushing a stale-enough item's clock forward. */
export function isReminderDue(input: { pendingSince: Date; lastReminderAt: Date | null; now: Date }): boolean {
  const hoursPending = (input.now.getTime() - input.pendingSince.getTime()) / MS_PER_HOUR
  if (hoursPending < REMINDER_STALE_HOURS) return false
  if (!input.lastReminderAt) return true
  const hoursSinceReminder = (input.now.getTime() - input.lastReminderAt.getTime()) / MS_PER_HOUR
  return hoursSinceReminder >= REMINDER_REPEAT_HOURS
}
