import { SectionIntro } from "@/components/shell/section-intro"
import { getCurrentUser } from "@/lib/auth"
import { countReviewedUnplaced } from "@/models/document-sheet-placements"
import { listRecentFiles } from "@/models/files"
import { requireWorkspaceRole } from "@/models/workspaces"
import { FileSpreadsheet, FilePlus2, ArrowDownToLine, Table2 } from "lucide-react"
import Link from "next/link"
import { SheetsCreateCard } from "@/components/files/sheets-create-card"
import { LastUpdated } from "@/components/shared/relative-time"

export const dynamic = "force-dynamic"

export default async function SheetsPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ pick?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const [recentFiles, unplacedCount] = await Promise.all([
    listRecentFiles(workspaceId, 50),
    countReviewedUnplaced(workspaceId),
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
        badge={unplacedCount > 0 ? unplacedCount : undefined}
      />
    </div>

    {pickIds.length > 0 && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
      <FilePlus2 className="h-4 w-4 shrink-0" />
      <span className="font-medium">{pickIds.length} document{pickIds.length === 1 ? "" : "s"} selected</span>
      <span className="text-emerald-600">—</span>
      <span>create a sheet above to pull them in.</span>
    </div>}

    {recentFiles.length > 0 && <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Your sheets</h2>
      <div className="divide-y rounded-xl border border-[#e6ebf1] bg-white shadow-panel">
        {recentFiles.map((file) => (
          <Link key={file.id} href={`${base}/files/${file.id}/sheet`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700">
              <Table2 className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
              <div className="text-xs text-slate-400">{file._count.documents} document{file._count.documents === 1 ? "" : "s"}{file.folder ? ` · ${file.folder.name}` : ""}</div>
            </div>
            <span className="shrink-0 text-xs text-slate-400"><LastUpdated iso={file.updatedAt.toISOString()} /></span>
          </Link>
        ))}
      </div>
    </section>}

    {recentFiles.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
      <FileSpreadsheet className="mx-auto h-10 w-10 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-500">No sheets yet</p>
      <p className="mt-1 text-xs text-slate-400">Create one above to get started.</p>
    </div>}
  </main>
}
