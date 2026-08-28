import { beforeEach, describe, expect, it, vi } from "vitest"

const { inboundEmail } = vi.hoisted(() => ({ inboundEmail: { enabled: true, secret: "test-secret", domain: "inbound.docubite.test" } }))
vi.mock("@/lib/config", () => ({ default: { get inboundEmail() { return inboundEmail } } }))
vi.mock("@/models/inbound-email", () => ({ resolveWorkspaceByInboundToken: vi.fn(), processInboundEmail: vi.fn() }))

const { POST } = await import("@/app/api/inbound-email/route")
const { resolveWorkspaceByInboundToken, processInboundEmail } = await import("@/models/inbound-email")

/** A recorded-shape Postmark inbound webhook fixture — the format this route is built and tested
 * against per the roadmap, ahead of any real provider being wired up. */
function postmarkFixture(overrides: Record<string, unknown> = {}) {
  return {
    To: "Inbox <abc123token@inbound.docubite.test>",
    From: "Jamie Owner <owner@example.com>",
    Subject: "Invoice attached",
    Attachments: [{ Name: "invoice.pdf", ContentType: "application/pdf", Content: Buffer.from("%PDF-1.4\n").toString("base64") }],
    ...overrides,
  }
}

function request(body: unknown, headers: Record<string, string> = { authorization: "Bearer test-secret" }) {
  return new Request("https://app.test/api/inbound-email", { method: "POST", headers, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  inboundEmail.enabled = true
  inboundEmail.secret = "test-secret"
})

describe("POST /api/inbound-email", () => {
  it("refuses everything when the feature is not configured", async () => {
    inboundEmail.enabled = false
    const response = await POST(request(postmarkFixture()))
    expect(response.status).toBe(503)
    expect(resolveWorkspaceByInboundToken).not.toHaveBeenCalled()
  })

  it("refuses a request with no bearer secret", async () => {
    const response = await POST(request(postmarkFixture(), {}))
    expect(response.status).toBe(401)
  })

  it("refuses a request with the wrong bearer secret", async () => {
    const response = await POST(request(postmarkFixture(), { authorization: "Bearer wrong" }))
    expect(response.status).toBe(401)
  })

  it("refuses a malformed payload missing To/From", async () => {
    const response = await POST(request({ Attachments: [] }))
    expect(response.status).toBe(400)
  })

  it("refuses an unknown recipient token", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue(null)
    const response = await POST(request(postmarkFixture()))
    expect(response.status).toBe(404)
    expect(resolveWorkspaceByInboundToken).toHaveBeenCalledWith("abc123token")
  })

  it("refuses a clinical workspace even with a valid token", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue({ id: "w1", industry: "healthcare" } as never)
    const response = await POST(request(postmarkFixture()))
    expect(response.status).toBe(403)
    expect(processInboundEmail).not.toHaveBeenCalled()
  })

  it("returns 403 when the model refuses the sender", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue({ id: "w1", industry: "finance" } as never)
    vi.mocked(processInboundEmail).mockRejectedValue(new Error("sender_not_allowed"))
    const response = await POST(request(postmarkFixture()))
    expect(response.status).toBe(403)
  })

  it("processes a valid recorded-shape payload end to end", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue({ id: "w1", industry: "finance" } as never)
    vi.mocked(processInboundEmail).mockResolvedValue({ accepted: 1, rejected: 0 })

    const response = await POST(request(postmarkFixture()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 })
    expect(vi.mocked(processInboundEmail).mock.calls[0][0]).toEqual({
      workspaceId: "w1", from: "owner@example.com",
      attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", base64Content: Buffer.from("%PDF-1.4\n").toString("base64") }],
    })
  })

  it("extracts a bare (non-bracketed) To/From address the same way", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue({ id: "w1", industry: "finance" } as never)
    vi.mocked(processInboundEmail).mockResolvedValue({ accepted: 0, rejected: 0 })

    await POST(request(postmarkFixture({ To: "abc123token@inbound.docubite.test", From: "owner@example.com" })))

    expect(resolveWorkspaceByInboundToken).toHaveBeenCalledWith("abc123token")
    expect(vi.mocked(processInboundEmail).mock.calls[0][0].from).toBe("owner@example.com")
  })

  it("drops an attachment missing a name, type, or content rather than crashing", async () => {
    vi.mocked(resolveWorkspaceByInboundToken).mockResolvedValue({ id: "w1", industry: "finance" } as never)
    vi.mocked(processInboundEmail).mockResolvedValue({ accepted: 0, rejected: 0 })

    await POST(request(postmarkFixture({ Attachments: [{ Name: "invoice.pdf" }] })))

    expect(vi.mocked(processInboundEmail).mock.calls[0][0].attachments).toEqual([])
  })
})
