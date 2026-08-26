import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/models/workspaces", () => ({ getPendingInvitationForEmail: vi.fn() }))
vi.mock("@/lib/config", () => ({ default: { auth: { disableSignup: false } } }))

const { assertSignupAllowed } = await import("@/lib/signup-gate")
const { getPendingInvitationForEmail } = await import("@/models/workspaces")
const config = (await import("@/lib/config")).default as { auth: { disableSignup: boolean } }

beforeEach(() => {
  vi.clearAllMocks()
  config.auth.disableSignup = false
})

describe("assertSignupAllowed", () => {
  it("allows anyone while sign-up is open, without looking for an invitation", async () => {
    await expect(assertSignupAllowed("stranger@example.com")).resolves.toBeUndefined()
    expect(getPendingInvitationForEmail).not.toHaveBeenCalled()
  })

  it("allows an invited address while sign-up is disabled", async () => {
    config.auth.disableSignup = true
    vi.mocked(getPendingInvitationForEmail).mockResolvedValue({ id: "i1" } as never)
    await expect(assertSignupAllowed("invitee@example.com")).resolves.toBeUndefined()
  })

  it("refuses an uninvited address while sign-up is disabled", async () => {
    config.auth.disableSignup = true
    vi.mocked(getPendingInvitationForEmail).mockResolvedValue(null)
    await expect(assertSignupAllowed("stranger@example.com")).rejects.toThrow("signup_disabled")
  })
})
