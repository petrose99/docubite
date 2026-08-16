import { randomBytes } from "crypto"
import { describe, expect, it } from "vitest"
import { parseInviteToken } from "./invite-token"

describe("parseInviteToken", () => {
  it("accepts a real invitation token", () => {
    const token = randomBytes(32).toString("base64url")
    expect(parseInviteToken(token)).toBe(token)
  })

  it("rejects anything that could steer the URL the server rebuilds", () => {
    for (const value of ["../admin", "//evil.com", "%2fevil", "http://evil.com", "a/b", "a.b", "a:b", "a?b=c", "a#b"]) {
      expect(parseInviteToken(value)).toBeNull()
    }
  })

  it("rejects empty, short, over-length and non-string input", () => {
    expect(parseInviteToken("")).toBeNull()
    expect(parseInviteToken("short")).toBeNull()
    expect(parseInviteToken("a".repeat(65))).toBeNull()
    expect(parseInviteToken(undefined)).toBeNull()
    expect(parseInviteToken(["a".repeat(30)])).toBeNull()
  })
})
