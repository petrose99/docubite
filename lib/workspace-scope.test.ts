import { WorkspaceScopeError, checkWorkspaceScope, hasWorkspaceFilter, unscoped } from "@/lib/workspace-scope"
import { describe, expect, it } from "vitest"

const WS = "11111111-1111-1111-1111-111111111111"

describe("hasWorkspaceFilter", () => {
  it("accepts a direct filter and one nested in AND/NOT", () => {
    expect(hasWorkspaceFilter({ workspaceId: WS })).toBe(true)
    expect(hasWorkspaceFilter({ AND: [{ status: "ready" }, { workspaceId: WS }] })).toBe(true)
    expect(hasWorkspaceFilter({ NOT: { workspaceId: WS } })).toBe(true)
  })

  it("accepts scoping through a relation", () => {
    expect(hasWorkspaceFilter({ file: { workspaceId: WS } })).toBe(true)
  })

  it("requires EVERY branch of an OR to be scoped", () => {
    // One unscoped branch widens the whole query, so a partially-scoped OR is not scoped.
    expect(hasWorkspaceFilter({ OR: [{ workspaceId: WS }, { workspaceId: "other" }] })).toBe(true)
    expect(hasWorkspaceFilter({ OR: [{ workspaceId: WS }, { status: "ready" }] })).toBe(false)
  })

  it("rejects an absent, empty, or undefined-valued filter", () => {
    expect(hasWorkspaceFilter(undefined)).toBe(false)
    expect(hasWorkspaceFilter({})).toBe(false)
    expect(hasWorkspaceFilter({ status: "ready" })).toBe(false)
    expect(hasWorkspaceFilter({ workspaceId: undefined })).toBe(false)
  })
})

describe("checkWorkspaceScope", () => {
  it("throws for an unscoped read of a workspace-scoped model", () => {
    expect(() => checkWorkspaceScope("Document", "findMany", { where: { status: "ready" } })).toThrow(WorkspaceScopeError)
    expect(() => checkWorkspaceScope("Document", "findMany", {})).toThrow(WorkspaceScopeError)
    expect(() => checkWorkspaceScope("DocumentChunk", "deleteMany", { where: {} })).toThrow(WorkspaceScopeError)
  })

  it("permits the same query once scoped", () => {
    expect(() => checkWorkspaceScope("Document", "findMany", { where: { workspaceId: WS, status: "ready" } })).not.toThrow()
  })

  it("leaves unscoped models alone", () => {
    // Identity and membership must be readable before a workspace is known.
    for (const model of ["User", "Session", "WorkspaceMember", "Workspace", "AdminAuditEvent"]) {
      expect(() => checkWorkspaceScope(model, "findMany", { where: {} })).not.toThrow()
    }
  })

  it("permits unique-key lookups, which already address exactly one row", () => {
    for (const operation of ["findUnique", "update", "delete", "upsert"]) {
      expect(() => checkWorkspaceScope("Document", operation, { where: { id: "doc-1" } })).not.toThrow()
    }
  })

  it("permits create, which has no where and whose workspaceId the column enforces", () => {
    expect(() => checkWorkspaceScope("Document", "create", { data: { workspaceId: WS } })).not.toThrow()
    expect(() => checkWorkspaceScope("Document", "createMany", { data: [] })).not.toThrow()
  })

  it("permits an explicitly unscoped call, and re-arms afterwards", async () => {
    await unscoped(async () => {
      expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).not.toThrow()
    })
    expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).toThrow(WorkspaceScopeError)
  })

  it("re-arms even when the unscoped callback throws", async () => {
    await expect(unscoped(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).toThrow(WorkspaceScopeError)
  })

  it("handles nesting without lifting the guard early", async () => {
    await unscoped(async () => {
      await unscoped(async () => {
        expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).not.toThrow()
      })
      // Still inside the outer unscoped() — the inner exit must not re-arm.
      expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).not.toThrow()
    })
    expect(() => checkWorkspaceScope("Document", "findMany", { where: {} })).toThrow(WorkspaceScopeError)
  })

  it("names the model and operation, so a warning is actionable", () => {
    expect(() => checkWorkspaceScope("DocumentFieldValue", "count", { where: {} }))
      .toThrow(/DocumentFieldValue\.count\(\).*workspaceId/s)
  })
})
