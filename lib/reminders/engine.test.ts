import { describe, expect, it } from "vitest"
import { isReminderDue, REMINDER_REPEAT_HOURS, REMINDER_STALE_HOURS } from "@/lib/reminders/engine"

const now = new Date("2026-08-29T12:00:00Z")
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

describe("isReminderDue", () => {
  it("is not due before the stale threshold", () => {
    expect(isReminderDue({ pendingSince: hoursAgo(REMINDER_STALE_HOURS - 1), lastReminderAt: null, now })).toBe(false)
  })

  it("is due right at the stale threshold with no prior reminder", () => {
    expect(isReminderDue({ pendingSince: hoursAgo(REMINDER_STALE_HOURS), lastReminderAt: null, now })).toBe(true)
  })

  it("is not due again before the repeat window even if long past stale", () => {
    expect(isReminderDue({ pendingSince: hoursAgo(500), lastReminderAt: hoursAgo(REMINDER_REPEAT_HOURS - 1), now })).toBe(false)
  })

  it("is due again once the repeat window has passed", () => {
    expect(isReminderDue({ pendingSince: hoursAgo(500), lastReminderAt: hoursAgo(REMINDER_REPEAT_HOURS), now })).toBe(true)
  })
})
