import { SectionIntro } from "@/components/shell/section-intro"
import { getCurrentUser } from "@/lib/auth"
import { countReviewedUnplaced } from "@/models/document-sheet-placements"
import { listFiles, listFolders, folderTrail } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"
import { FileSpreadsheet, FilePlus2, ArrowDownToLine, Table2, FolderOpen, ChevronRight } from "lucide-react"
import Link from "next/link"
import { SheetsCreateCard } from "@/components/files/sheets-create-card"
import { SheetsFolderActions } from "@/components/files/sheets-folder-actions"
import { LastUpdated } from "@/components/shared/relative-time"

export const dynamic = "force-dynamic"

export default async function SheetsPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ pick?: string; q?: string; folder?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const search = query.q?.trim() || ""
  const folderId = query.folder || null

  const [files, folders, unplacedCount, trail] = await Promise.all([
    listFiles(workspaceId, { query: search || undefined, folderId: search ? undefined : folderId }),
    search ? [] : listFolders(workspaceId, { parentId: folderId }),
    countReviewedUnplaced(workspaceId),
    folderId ? folderTrail(workspaceId, folderId) : [],
  ])

  const pickIds = query.pick?.split(",").filter(Boolean) ?? []
  const base = `/workspaces/${workspaceId}`

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6">
    <header>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900">Sheets</h1>
        <SectionIntro section="sheets" workspaceId={workspaceId} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Spreadsheets you compute in — pull approved documents in, import your own files, and ask the AI assistant to do the work.
      </p>
    </header>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <SheetsCreateCard
        icon="blank"
        title="Blank sheet"
        description="Start from scratch with a fresh spreadsheet."
        workspaceId={workspaceId}
        folderId={folderId}
      />
      <SheetsCreateCard
        icon="import"
        title="Import xlsx / csv"
        description="Upload a spreadsheet file and start working."
        workspaceId={workspaceId}
        href={`${base}/files?import=1`}
      />
      <SheetsCreateCard
        icon="extraction"
        title="From Docu Library"
        description={unplacedCount > 0 ? `${unplacedCount} approved document${unplacedCount === 1 ? "" : "s"} ready to pull in.` : "Pull approved documents into a sheet."}
        workspaceId={workspaceId}
        href={`${base}/library?pick=sheet`}
        badge={unplacedCount > 0 ? unplacedCount : undefined}
      />
    </div>

    {pickIds.length > 0 && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
      <FilePlus2 className="h-4 w-4 shrink-0" />
      <span className="font-medium">{pickIds.length} document{pickIds.length === 1 ? "" : "s"} selected</span>
      <span className="text-emerald-600">—</span>
      <span>create a sheet above to pull them in.</span>
    </div>}

    <div className="flex items-center gap-3">
      <form action="" className="flex-1">
        {folderId && <input type="hidden" name="folder" value={folderId} />}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search sheets..."
          className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
      </form>
      <SheetsFolderActions workspaceId={workspaceId} parentId={folderId} />
    </div>

    {trail.length > 0 && (
      <nav className="flex items-center gap-1 text-sm text-slate-500">
        <Link href={`${base}/files`} className="hover:text-emerald-700">Sheets</Link>
        {trail.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <Link href={`${base}/files?folder=${crumb.id}`} className="hover:text-emerald-700">{crumb.name}</Link>
          </span>
        ))}
      </nav>
    )}

    {(folders.length > 0 || files.length > 0) ? (
      <div className="divide-y rounded-xl border border-[#e6ebf1] bg-white shadow-panel">
        {folders.map((folder) => (
          <Link key={folder.id} href={`${base}/files?folder=${folder.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-amber-50 text-amber-600">
              <FolderOpen className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">{folder.name}</div>
              <div className="text-xs text-slate-400">
                {folder._count.files} sheet{folder._count.files === 1 ? "" : "s"}
                {folder._count.children > 0 ? ` · ${folder._count.children} folder${folder._count.children === 1 ? "" : "s"}` : ""}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
          </Link>
        ))}
        {files.map((file) => (
          <Link key={file.id} href={`${base}/files/${file.id}/sheet`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700">
              <Table2 className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
              {search && file.folder && <div className="text-xs text-slate-400">in {file.folder.name}</div>}
            </div>
            <span className="shrink-0 text-xs text-slate-400"><LastUpdated iso={file.updatedAt.toISOString()} /></span>
          </Link>
        ))}
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
        <FileSpreadsheet className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-500">
          {search ? "No sheets match your search." : "No sheets yet"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {search ? "Try a different query." : "Create one above to get started."}
        </p>
      </div>
    )}
  </main>
}
