import { FilesBrowser } from "@/components/files/files-browser"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { searchDocumentsByContent } from "@/lib/retrieval"
import { folderTrail, listAllFolders, listFiles, listFilesSharedWith, listFolders, type FileSortField } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"

/** The folder being searched from, and its descendants — the "in this folder" side of the grouped
 * search results. BFS over the flat folder list (each carrying parentId), so subfolder matches count
 * as in-scope too. */
function descendantFolderIds(allFolders: Array<{ id: string; parentId: string | null }>, rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const folder of allFolders) {
    if (!folder.parentId) continue
    const list = children.get(folder.parentId) ?? []
    list.push(folder.id)
    children.set(folder.parentId, list)
  }
  const ids = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    for (const child of children.get(id) ?? []) if (!ids.has(child)) { ids.add(child); stack.push(child) }
  }
  return ids
}

/** The landing page. Lido drops you here, not into a spreadsheet: files and folders, a search
 * box, My Files / Shared With Me, and the two creation affordances. */
export default async function FilesPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ folder?: string; q?: string; sort?: string; dir?: string; tab?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const folderId = query.folder || null
  const search = query.q?.trim() || ""
  const sort: FileSortField = query.sort === "name" ? "name" : "updatedAt"
  const dir = query.dir === "asc" ? "asc" : "desc"
  const tab = query.tab === "shared" ? "shared" : "mine"

  // Content search runs only for a real query on My Files with the feature on — shared files live in
  // other workspaces, which this search does not span.
  const contentSearchOn = tab === "mine" && !!search && config.embeddings.enabled

  const [files, folders, allFolders, trail, shared, contentMatches] = await Promise.all([
    tab === "mine" ? listFiles(workspaceId, { folderId, query: search, sort, dir }) : Promise.resolve([]),
    tab === "mine" && !search ? listFolders(workspaceId, { parentId: folderId }) : Promise.resolve([]),
    tab === "mine" ? listAllFolders(workspaceId) : Promise.resolve([]),
    folderTrail(workspaceId, folderId),
    tab === "shared" ? listFilesSharedWith(user.email) : Promise.resolve([]),
    contentSearchOn ? searchDocumentsByContent(workspaceId, search, { limit: 12, actorId: user.id }) : Promise.resolve([]),
  ])

  // Grouped results only exist when searching from inside a folder with the feature on. `inScope`
  // partitions both name matches and content matches against that folder and its descendants.
  const scopeIds = contentSearchOn && folderId ? descendantFolderIds(allFolders, folderId) : null
  const scopeFolderName = scopeIds ? (trail[trail.length - 1]?.name ?? null) : null
  const inScope = (fid: string | null) => (scopeIds ? fid != null && scopeIds.has(fid) : true)

  const base = `/workspaces/${workspaceId}/files`

  return <main className="flex min-h-0 flex-1 flex-col">
    <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
      <h1 className="text-xl font-bold text-stone-900">Files</h1>
      <nav className="ml-4 flex items-center gap-1 text-sm">
        <Link href={base} className={`rounded-md px-2.5 py-1 font-medium ${tab === "mine" ? "bg-stone-100 text-stone-900" : "text-stone-500 hover:text-stone-800"}`}>My Files</Link>
        <Link href={`${base}?tab=shared`} className={`rounded-md px-2.5 py-1 font-medium ${tab === "shared" ? "bg-stone-100 text-stone-900" : "text-stone-500 hover:text-stone-800"}`}>Shared With Me</Link>
      </nav>
    </header>

    <FilesBrowser
      workspaceId={workspaceId}
      tab={tab}
      folderId={folderId}
      trail={trail}
      search={search}
      sort={sort}
      dir={dir}
      documentSearchEnabled={config.embeddings.enabled}
      scopeFolderName={scopeFolderName}
      folders={folders.map((folder) => ({ id: folder.id, name: folder.name, fileCount: folder._count.files, folderCount: folder._count.children }))}
      allFolders={allFolders}
      files={files.map((file) => ({
        id: file.id, name: file.name, updatedAt: file.updatedAt.toISOString(), linkAccess: file.linkAccess,
        documentCount: file._count.documents, shareCount: file._count.shares,
        folderName: file.folder?.name ?? null, folderId: file.folder?.id ?? null, inScope: inScope(file.folder?.id ?? null),
        workspaceId: file.workspaceId, sharedAccess: null,
      }))}
      contentMatches={contentMatches.map((match) => ({
        documentId: match.documentId, filename: match.filename, fileId: match.fileId, fileName: match.fileName,
        page: match.page, bbox: match.bbox, snippet: match.snippet, inScope: inScope(match.folderId),
      }))}
      sharedFiles={shared.map((file) => ({
        id: file.id, name: file.name, updatedAt: file.updatedAt.toISOString(), linkAccess: file.linkAccess,
        documentCount: file._count.documents, shareCount: file._count.shares,
        folderName: null, workspaceId: file.workspaceId, sharedAccess: file.sharedAccess,
      }))} />
  </main>
}
