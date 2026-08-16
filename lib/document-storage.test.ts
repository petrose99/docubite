import { documentStorageKey } from "@/lib/document-storage"
import { describe, expect, it } from "vitest"

describe("documentStorageKey", () => {
  it("builds a deterministic path from workspace and document IDs", () => {
    const key = documentStorageKey("ws-123", "doc-456")
    expect(key).toBe("workspaces/ws-123/documents/doc-456/source")
  })

  it("includes both IDs for workspace isolation", () => {
    const a = documentStorageKey("ws-a", "doc-1")
    const b = documentStorageKey("ws-b", "doc-1")
    expect(a).not.toBe(b)
  })
})
