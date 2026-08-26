import { encryptSecret } from "@/lib/secret-crypto"
import { IntegrationAuthError } from "@/lib/integrations/errors"
import { beforeEach, describe, expect, it, vi } from "vitest"

const queryRawMock = vi.fn()
const executeRawMock = vi.fn()
const refreshQuickbooksMock = vi.fn()
const refreshXeroMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: queryRawMock, $executeRaw: executeRawMock }),
  },
}))

vi.mock("@/lib/integrations/quickbooks/client", () => ({ refreshTokens: (...args: unknown[]) => refreshQuickbooksMock(...args) }))
vi.mock("@/lib/integrations/xero/client", () => ({ refreshTokens: (...args: unknown[]) => refreshXeroMock(...args) }))

// Real encryption keeps the test honest about the decrypt path without needing a real DB.
// (SECRETS_ENCRYPTION_KEY is set globally in vitest.config.ts.)
const { getValidAccessToken, TokenRefreshError } = await import("@/lib/integration-token-refresh")

function connectionRow(overrides: Partial<{
  id: string; provider: string; status: string; access_token_enc: string; refresh_token_enc: string; access_token_expires_at: Date | null
}> = {}) {
  return {
    id: "conn_1",
    provider: "quickbooks",
    status: "active",
    access_token_enc: encryptSecret("old-access-token"),
    refresh_token_enc: encryptSecret("old-refresh-token"),
    access_token_expires_at: new Date("2026-08-26T12:30:00Z"),
    ...overrides,
  }
}

const now = new Date("2026-08-26T12:00:00Z")

beforeEach(() => {
  queryRawMock.mockReset()
  executeRawMock.mockReset()
  refreshQuickbooksMock.mockReset()
  refreshXeroMock.mockReset()
})

describe("getValidAccessToken", () => {
  it("returns the decrypted token without refreshing when it is fresh outside the buffer", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: new Date("2026-08-26T12:10:00Z") })])
    const token = await getValidAccessToken("conn_1", now)
    expect(token).toBe("old-access-token")
    expect(refreshQuickbooksMock).not.toHaveBeenCalled()
    expect(executeRawMock).not.toHaveBeenCalled()
  })

  it("refreshes when the token expires within the 2-minute buffer", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: new Date("2026-08-26T12:01:00Z") })])
    refreshQuickbooksMock.mockResolvedValue({ accessToken: "new-access-token", refreshToken: "new-refresh-token", expiresInSeconds: 3600 })
    const token = await getValidAccessToken("conn_1", now)
    expect(token).toBe("new-access-token")
    expect(refreshQuickbooksMock).toHaveBeenCalledWith("old-refresh-token")
    expect(executeRawMock).toHaveBeenCalledTimes(1)
  })

  it("refreshes when already expired", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: new Date("2026-08-26T11:00:00Z") })])
    refreshQuickbooksMock.mockResolvedValue({ accessToken: "new-access-token", refreshToken: "new-refresh-token", expiresInSeconds: 3600 })
    await getValidAccessToken("conn_1", now)
    expect(refreshQuickbooksMock).toHaveBeenCalled()
  })

  it("refreshes when there is no recorded expiry at all", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: null })])
    refreshQuickbooksMock.mockResolvedValue({ accessToken: "new-access-token", refreshToken: "new-refresh-token", expiresInSeconds: 3600 })
    await getValidAccessToken("conn_1", now)
    expect(refreshQuickbooksMock).toHaveBeenCalled()
  })

  it("dispatches to the xero client for a xero connection", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ provider: "xero", access_token_expires_at: new Date("2026-08-26T11:00:00Z") })])
    refreshXeroMock.mockResolvedValue({ accessToken: "xero-access", refreshToken: "xero-refresh", expiresInSeconds: 1800 })
    const token = await getValidAccessToken("conn_1", now)
    expect(token).toBe("xero-access")
    expect(refreshXeroMock).toHaveBeenCalledWith("old-refresh-token")
    expect(refreshQuickbooksMock).not.toHaveBeenCalled()
  })

  it("marks the connection needs_reauth and throws on an auth-shaped refresh failure", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: new Date("2026-08-26T11:00:00Z") })])
    refreshQuickbooksMock.mockRejectedValue(new IntegrationAuthError("quickbooks_token_http_400"))
    await expect(getValidAccessToken("conn_1", now)).rejects.toThrow(TokenRefreshError)
    expect(executeRawMock).toHaveBeenCalledTimes(1)
    const sql = executeRawMock.mock.calls[0][0].join("")
    expect(sql).toContain("needs_reauth")
  })

  it("bubbles a plain retryable error for a non-auth refresh failure without touching status", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ access_token_expires_at: new Date("2026-08-26T11:00:00Z") })])
    refreshQuickbooksMock.mockRejectedValue(new Error("network_timeout"))
    await expect(getValidAccessToken("conn_1", now)).rejects.toThrow(TokenRefreshError)
    expect(executeRawMock).not.toHaveBeenCalled()
  })

  it("throws immediately without refreshing when the connection is already needs_reauth", async () => {
    queryRawMock.mockResolvedValue([connectionRow({ status: "needs_reauth" })])
    await expect(getValidAccessToken("conn_1", now)).rejects.toThrow(TokenRefreshError)
    expect(refreshQuickbooksMock).not.toHaveBeenCalled()
  })

  it("throws when the connection does not exist", async () => {
    queryRawMock.mockResolvedValue([])
    await expect(getValidAccessToken("missing", now)).rejects.toThrow(TokenRefreshError)
  })
})
