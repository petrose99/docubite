import { describe, expect, it } from "vitest"
import { buildFolderPath, type FolderNode } from "./folder-path"

describe("buildFolderPath", () => {
  const folders: FolderNode[] = [
    { id: "root", name: "Invoices", parentId: null },
    { id: "sub1", name: "2026", parentId: "root" },
    { id: "sub2", name: "Q1", parentId: "sub1" },
  ]

  it("builds root-level path", () => {
    expect(buildFolderPath("root", folders)).toBe("/Invoices")
  })

  it("builds nested path", () => {
    expect(buildFolderPath("sub1", folders)).toBe("/Invoices/2026")
  })

  it("builds deeply nested path", () => {
    expect(buildFolderPath("sub2", folders)).toBe("/Invoices/2026/Q1")
  })

  it("returns just slash for unknown folder", () => {
    expect(buildFolderPath("nonexistent", folders)).toBe("/")
  })

  it("handles circular references gracefully", () => {
    const circular: FolderNode[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]
    const result = buildFolderPath("a", circular)
    expect(result).toContain("/A")
    expect(result).toContain("/B")
  })
})
