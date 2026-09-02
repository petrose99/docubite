import { prisma } from "@/lib/db"

export type FolderNode = {
  id: string
  name: string
  parentId: string | null
}

export function buildFolderPath(folderId: string, folders: FolderNode[]): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  let current = byId.get(folderId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return "/" + parts.join("/")
}

export async function materializeFolderPaths(workspaceId: string): Promise<number> {
  const folders = await prisma.documentFolder.findMany({
    where: { workspaceId },
    select: { id: true, name: true, parentId: true },
  })

  const files = await prisma.documentFile.findMany({
    where: { workspaceId, folderId: { not: null } },
    select: { id: true, folderId: true },
  })

  let updated = 0
  for (const file of files) {
    if (!file.folderId) continue
    const path = buildFolderPath(file.folderId, folders)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- folderPath column added by migration, types available after db:generate
    await (prisma.documentFile.update as any)({
      where: { id: file.id },
      data: { folderPath: path },
    })
    updated++
  }

  return updated
}

export async function updateFileFolderPath(fileId: string, workspaceId: string, folderId: string | null): Promise<string | null> {
  if (!folderId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types available after db:generate
    await (prisma.documentFile.update as any)({ where: { id: fileId }, data: { folderPath: null } })
    return null
  }

  const folders = await prisma.documentFolder.findMany({
    where: { workspaceId },
    select: { id: true, name: true, parentId: true },
  })

  const path = buildFolderPath(folderId, folders)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types available after db:generate
  await (prisma.documentFile.update as any)({ where: { id: fileId }, data: { folderPath: path } })
  return path
}
