import { FilesBrowser } from "@/components/files/files-browser"
import { getCurrentUser } from "@/lib/auth"
import { folderTrail, listAllFolders, listFiles, listFilesSharedWith, listFolders, type FileSortField } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"

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

  const [files, folders, allFolders, trail, shared] = await Promise.all([
    tab === "mine" ? listFiles(workspaceId, { folderId, query: search, sort, dir }) : Promise.resolve([]),
    tab === "mine" && !search ? listFolders(workspaceId, { parentId: folderId }) : Promise.resolve([]),
    tab === "mine" ? listAllFolders(workspaceId) : Promise.resolve([]),
    folderTrail(workspaceId, folderId),
    tab === "shared" ? listFilesSharedWith(user.email) : Promise.resolve([]),
  ])

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
      folders={folders.map((folder) => ({ id: folder.id, name: folder.name, fileCount: folder._count.files, folderCount: folder._count.children }))}
      allFolders={allFolders}
      files={files.map((file) => ({
        id: file.id, name: file.name, updatedAt: file.updatedAt.toISOString(), linkAccess: file.linkAccess,
        documentCount: file._count.documents, shareCount: file._count.shares,
        folderName: file.folder?.name ?? null, workspaceId: file.workspaceId, sharedAccess: null,
      }))}
      sharedFiles={shared.map((file) => ({
        id: file.id, name: file.name, updatedAt: file.updatedAt.toISOString(), linkAccess: file.linkAccess,
        documentCount: file._count.documents, shareCount: file._count.shares,
        folderName: null, workspaceId: file.workspaceId, sharedAccess: file.sharedAccess,
      }))} />
  </main>
}
