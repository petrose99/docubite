import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {} }))

const { getTaxProfile, setTaxRegion } = await import("@/models/tax-profiles")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("getTaxProfile", () => {
  it("returns null when the workspace has no profile", async () => {
    db.taxProfile = { findFirst: vi.fn().mockResolvedValue(null) }
    expect(await getTaxProfile("w1")).toBeNull()
  })

  it("returns the current version's config", async () => {
    db.taxProfile = { findFirst: vi.fn().mockResolvedValue({ id: "p1", region: "za", currentVersion: 2, versions: [{ version: 2, config: { region: "za", currency: "ZAR" } }] }) }
    const profile = await getTaxProfile("w1")
    expect(profile).toEqual({ id: "p1", region: "za", currentVersion: 2, config: { region: "za", currency: "ZAR" } })
  })
})

describe("setTaxRegion", () => {
  it("creates a new profile at version 1 when none exists", async () => {
    db.taxProfile = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "p1" }) }
    await setTaxRegion("w1", "za")
    expect(db.taxProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "w1", region: "za", versions: { create: expect.objectContaining({ version: 1 }) } }),
    }))
  })

  it("bumps currentVersion and writes a new immutable version when a profile already exists", async () => {
    db.taxProfile = { findFirst: vi.fn().mockResolvedValue({ id: "p1", currentVersion: 3 }), update: vi.fn().mockReturnValue("update") }
    db.taxProfileVersion = { create: vi.fn().mockReturnValue("version") }

    await setTaxRegion("w1", "gb")

    expect(db.taxProfile.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { region: "gb", currentVersion: 4 } })
    expect(db.taxProfileVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ profileId: "p1", version: 4 }) }))
    expect(db.$transaction).toHaveBeenCalledWith(["update", "version"])
  })
})
