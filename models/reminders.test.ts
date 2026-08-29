import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/email", () => ({ sendReminderEmail: vi.fn().mockResolvedValue(undefined) }))

const { sendDueReminders } = await import("@/models/reminders")
const { prisma } = await import("@/lib/db")
const { sendReminderEmail } = await import("@/lib/email")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any
const now = new Date("2026-08-29T12:00:00Z")
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.reviewTask = { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() }
  db.expenseClaim = { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() }
  db.workspaceMember = { findMany: vi.fn().mockResolvedValue([]) }
})

describe("sendDueReminders — review tasks", () => {
  it("skips a task that hasn't been pending long enough", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(1), lastReminderAt: null, document: { filename: "inv.pdf" }, assignee: null },
    ])
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(0)
    expect(sendReminderEmail).not.toHaveBeenCalled()
  })

  it("emails the assignee when one is set", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(100), lastReminderAt: null, document: { filename: "inv.pdf" }, assignee: { email: "assignee@x.com" } },
    ])
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(1)
    expect(sendReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "assignee@x.com" }))
    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { lastReminderAt: now } })
  })

  it("falls back to every workspace owner when there's no assignee", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(100), lastReminderAt: null, document: { filename: "inv.pdf" }, assignee: null },
    ])
    db.workspaceMember.findMany.mockResolvedValue([{ user: { email: "owner1@x.com" } }, { user: { email: "owner2@x.com" } }])
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(1)
    expect(sendReminderEmail).toHaveBeenCalledTimes(2)
    expect(sendReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner1@x.com" }))
    expect(sendReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner2@x.com" }))
  })

  it("does not resend within the repeat window", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(200), lastReminderAt: hoursAgo(10), document: { filename: "inv.pdf" }, assignee: { email: "a@x.com" } },
    ])
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(0)
    expect(sendReminderEmail).not.toHaveBeenCalled()
  })

  it("does not stamp lastReminderAt and keeps going when the send fails", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(100), lastReminderAt: null, document: { filename: "a.pdf" }, assignee: { email: "a@x.com" } },
      { id: "t2", workspaceId: "w1", createdAt: hoursAgo(100), lastReminderAt: null, document: { filename: "b.pdf" }, assignee: { email: "b@x.com" } },
    ])
    ;(sendReminderEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("resend down")).mockResolvedValueOnce(undefined)
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(1)
    expect(db.reviewTask.update).toHaveBeenCalledTimes(1)
    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t2" }, data: { lastReminderAt: now } })
    consoleSpy.mockRestore()
  })

  it("skips silently when there is no one to notify", async () => {
    db.reviewTask.findMany.mockResolvedValue([
      { id: "t1", workspaceId: "w1", createdAt: hoursAgo(100), lastReminderAt: null, document: { filename: "inv.pdf" }, assignee: null },
    ])
    db.workspaceMember.findMany.mockResolvedValue([])
    const result = await sendDueReminders(now)
    expect(result.reviewTasks).toBe(0)
    expect(db.reviewTask.update).not.toHaveBeenCalled()
  })
})

describe("sendDueReminders — expense claims", () => {
  it("emails workspace owners for a stale submitted claim", async () => {
    db.expenseClaim.findMany.mockResolvedValue([
      { id: "c1", workspaceId: "w1", submittedAt: hoursAgo(100), lastReminderAt: null, title: "Trip" },
    ])
    db.workspaceMember.findMany.mockResolvedValue([{ user: { email: "owner@x.com" } }])
    const result = await sendDueReminders(now)
    expect(result.expenseClaims).toBe(1)
    expect(sendReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@x.com", subject: expect.stringContaining("Trip") }))
    expect(db.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { lastReminderAt: now } })
  })

  it("skips a claim not yet stale", async () => {
    db.expenseClaim.findMany.mockResolvedValue([
      { id: "c1", workspaceId: "w1", submittedAt: hoursAgo(1), lastReminderAt: null, title: "Trip" },
    ])
    const result = await sendDueReminders(now)
    expect(result.expenseClaims).toBe(0)
  })
})
