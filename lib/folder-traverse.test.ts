import { walkTree, type TreeNode } from "@/components/extract/folder-traverse"
import { describe, expect, it } from "vitest"

const makeFile = (name: string, type = "application/pdf") => new File(["data"], name, { type })
const fileNode = (name: string, type?: string): TreeNode => ({ kind: "file", name, file: async () => makeFile(name, type) })
const dirNode = (name: string, children: TreeNode[]): TreeNode => ({ kind: "dir", name, children: async () => children })

const acceptPdf = { accept: (file: File) => file.type === "application/pdf", maxFiles: 100 }

describe("walkTree", () => {
  it("collects accepted files with their folder path", async () => {
    const tree: TreeNode[] = [
      fileNode("top.pdf"),
      dirNode("invoices", [fileNode("jan.pdf"), dirNode("q1", [fileNode("feb.pdf")])]),
    ]
    const result = await walkTree(tree, acceptPdf)
    expect(result.map((entry) => entry.relativePath)).toEqual(["top.pdf", "invoices/jan.pdf", "invoices/q1/feb.pdf"])
  })

  it("skips dot-files and dot-folders and files that fail the filter", async () => {
    const tree: TreeNode[] = [
      fileNode("keep.pdf"),
      fileNode(".hidden.pdf"),
      fileNode("note.txt", "text/plain"),
      dirNode(".git", [fileNode("config.pdf")]),
    ]
    const result = await walkTree(tree, acceptPdf)
    expect(result.map((entry) => entry.relativePath)).toEqual(["keep.pdf"])
  })

  it("stops once the file cap is reached", async () => {
    const tree: TreeNode[] = [fileNode("a.pdf"), fileNode("b.pdf"), fileNode("c.pdf")]
    const result = await walkTree(tree, { accept: () => true, maxFiles: 2 })
    expect(result.map((entry) => entry.relativePath)).toEqual(["a.pdf", "b.pdf"])
  })

  it("does not descend past the depth limit", async () => {
    // 8 nested folders, each holding the next plus a file; MAX_DEPTH is 6.
    let deepest: TreeNode = fileNode("bottom.pdf")
    for (let level = 8; level >= 1; level--) deepest = dirNode(`level${level}`, [deepest])
    const result = await walkTree([deepest], acceptPdf)
    expect(result).toEqual([])
  })
})
