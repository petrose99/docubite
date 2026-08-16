/** An abstract file/directory tree, so the walk can be tested without a real DataTransfer. The
 * DataTransfer adapter below maps the browser's FileSystemEntry API onto this shape. */
export type FileNode = { kind: "file"; name: string; file: () => Promise<File> }
export type DirNode = { kind: "dir"; name: string; children: () => Promise<TreeNode[]> }
export type TreeNode = FileNode | DirNode

export type StagedEntry = { file: File; relativePath: string }

const MAX_DEPTH = 6

/** Walks a file/dir tree depth-first, collecting the files that pass `accept` with the folder path
 * they were found under. Bounded on both depth and count so a deeply-nested or enormous folder drop
 * cannot run away; dot-files and dot-folders are skipped. Pure over the TreeNode interface. */
export async function walkTree(nodes: TreeNode[], options: { accept: (file: File) => boolean; maxFiles: number }): Promise<StagedEntry[]> {
  const collected: StagedEntry[] = []
  const visit = async (node: TreeNode, prefix: string, depth: number): Promise<void> => {
    if (collected.length >= options.maxFiles || node.name.startsWith(".")) return
    if (node.kind === "file") {
      const file = await node.file()
      if (options.accept(file)) collected.push({ file, relativePath: prefix ? `${prefix}/${node.name}` : node.name })
      return
    }
    if (depth >= MAX_DEPTH) return
    const children = await node.children()
    for (const child of children) {
      if (collected.length >= options.maxFiles) break
      await visit(child, prefix ? `${prefix}/${node.name}` : node.name, depth + 1)
    }
  }
  for (const node of nodes) {
    if (collected.length >= options.maxFiles) break
    await visit(node, "", 0)
  }
  return collected
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebkitEntry = any

/** Adapts a browser FileSystemEntry (from webkitGetAsEntry) onto a TreeNode, promisifying its
 * callback-based file()/readEntries(). readEntries returns at most 100 per call, so it is drained
 * in a loop until it yields nothing. */
function toTreeNode(entry: WebkitEntry): TreeNode {
  if (entry.isFile) {
    return { kind: "file", name: entry.name, file: () => new Promise<File>((resolve, reject) => entry.file(resolve, reject)) }
  }
  return {
    kind: "dir",
    name: entry.name,
    children: async () => {
      const reader = entry.createReader()
      const all: WebkitEntry[] = []
      for (;;) {
        const batch: WebkitEntry[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        all.push(...batch)
      }
      return all.map(toTreeNode)
    },
  }
}

/** Pulls every accepted file out of a drop's DataTransfer items, descending into any dropped
 * folders. Falls back silently to nothing for items that expose no entry (the caller uses
 * dataTransfer.files in that case). */
export async function filesFromDataTransfer(items: DataTransferItemList, options: { accept: (file: File) => boolean; maxFiles: number }): Promise<StagedEntry[]> {
  const roots: TreeNode[] = []
  for (const item of Array.from(items)) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => WebkitEntry }).webkitGetAsEntry?.()
    if (entry) roots.push(toTreeNode(entry))
  }
  return walkTree(roots, options)
}
