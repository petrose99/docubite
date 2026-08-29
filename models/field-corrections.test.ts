import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const { getFewShotExamples, recordFieldCorrection } = await import("@/models/field-corrections")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.fieldCorrection = { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() }
})

describe("recordFieldCorrection", () => {
  it("upserts on the (workspace, template, field, wrong, corrected) key", async () => {
    await recordFieldCorrection({ workspaceId: "w1", templateCode: "invoice", fieldKey: "vendor", supplier: "Acme", wrongValue: "Acme In", correctedValue: "Acme Inc" })
    expect(db.fieldCorrection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_templateCode_fieldKey_wrongValue_correctedValue: { workspaceId: "w1", templateCode: "invoice", fieldKey: "vendor", wrongValue: "Acme In", correctedValue: "Acme Inc" } },
    }))
  })

  it("evicts the oldest rows once a field exceeds the cap", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `row-${i}` }))
    db.fieldCorrection.findMany.mockResolvedValue(rows)
    await recordFieldCorrection({ workspaceId: "w1", templateCode: "invoice", fieldKey: "vendor", supplier: null, wrongValue: "a", correctedValue: "b" })
    expect(db.fieldCorrection.deleteMany).toHaveBeenCalledWith({ where: { id: { in: rows.slice(20).map((r) => r.id) } } })
  })

  it("does not evict when under the cap", async () => {
    db.fieldCorrection.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `row-${i}` })))
    await recordFieldCorrection({ workspaceId: "w1", templateCode: "invoice", fieldKey: "vendor", supplier: null, wrongValue: "a", correctedValue: "b" })
    expect(db.fieldCorrection.deleteMany).not.toHaveBeenCalled()
  })

  it("swallows a database error rather than throwing", async () => {
    db.fieldCorrection.upsert.mockRejectedValue(new Error("db down"))
    await expect(recordFieldCorrection({ workspaceId: "w1", templateCode: "invoice", fieldKey: "vendor", supplier: null, wrongValue: "a", correctedValue: "b" })).resolves.toBeUndefined()
  })
})

describe("getFewShotExamples", () => {
  it("orders by hitCount then recency and truncates long values", async () => {
    const longValue = "x".repeat(250)
    db.fieldCorrection.findMany.mockResolvedValue([{ fieldKey: "vendor", wrongValue: longValue, correctedValue: "short" }])
    const examples = await getFewShotExamples("w1", "invoice", 8)
    expect(examples[0].wrongValue.length).toBe(201)
    expect(examples[0].wrongValue.endsWith("…")).toBe(true)
    expect(db.fieldCorrection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "w1", templateCode: "invoice" },
      orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
      take: 8,
    }))
  })
})
