import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() } } }))
vi.mock("@/lib/signup-gate", () => ({ assertSignupAllowed: vi.fn() }))

const { resolveOrProvisionUser } = await import("@/models/users")
const { prisma } = await import("@/lib/db")
const { assertSignupAllowed } = await import("@/lib/signup-gate")

describe("resolveOrProvisionUser", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset()
    vi.mocked(prisma.user.update).mockReset()
    vi.mocked(prisma.user.create).mockReset()
    vi.mocked(assertSignupAllowed).mockReset().mockResolvedValue(undefined)
  })

  it("returns the row directly when supabaseUserId is already linked", async () => {
    const existing = { id: "u1", supabaseUserId: "sb1", email: "a@example.com" }
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(existing as never)

    const result = await resolveOrProvisionUser({ supabaseUserId: "sb1", email: "a@example.com" })

    expect(result).toBe(existing)
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it("links a pre-migration row by email on its first post-migration sign-in", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null) // by supabaseUserId
      .mockResolvedValueOnce({ id: "u1", supabaseUserId: null, email: "migrated@example.com" } as never) // by email
    vi.mocked(prisma.user.update).mockResolvedValueOnce({ id: "u1", supabaseUserId: "sb2" } as never)

    const result = await resolveOrProvisionUser({ supabaseUserId: "sb2", email: "migrated@example.com" })

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { supabaseUserId: "sb2" } })
    expect(result).toEqual({ id: "u1", supabaseUserId: "sb2" })
  })

  it("refuses to relink an email already claimed by a different Supabase identity", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "u1", supabaseUserId: "sb-other", email: "taken@example.com" } as never)

    await expect(resolveOrProvisionUser({ supabaseUserId: "sb2", email: "taken@example.com" })).rejects.toThrow("email_already_linked_to_different_identity")
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("creates a new row, active, for a genuinely new signup that passes the gate", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u2" } as never)

    await resolveOrProvisionUser({ supabaseUserId: "sb3", email: "New.User@Example.com ", name: "  New User " })

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { supabaseUserId: "sb3", email: "new.user@example.com", name: "New User" },
    })
  })

  it("creates the row suspended when assertSignupAllowed rejects — the Auth Hook's fallback", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(assertSignupAllowed).mockRejectedValueOnce(new Error("signup_disabled"))
    vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u3" } as never)

    await resolveOrProvisionUser({ supabaseUserId: "sb4", email: "blocked@example.com" })

    const call = vi.mocked(prisma.user.create).mock.calls[0][0]
    expect(call.data).toMatchObject({ supabaseUserId: "sb4", email: "blocked@example.com" })
    expect(call.data).toHaveProperty("suspendedAt")
  })

  it("falls back to the local part of the email when no name is given", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u4" } as never)

    await resolveOrProvisionUser({ supabaseUserId: "sb5", email: "noname@example.com" })

    expect(prisma.user.create).toHaveBeenCalledWith({ data: { supabaseUserId: "sb5", email: "noname@example.com", name: "noname" } })
  })
})
