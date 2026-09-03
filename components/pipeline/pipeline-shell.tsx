import { DocumentList, type ContentMatchRow, type PipelineDocumentRow } from "@/components/pipeline/document-list"
import { FilterPanel } from "@/components/pipeline/filter-panel"
import { StageTabs } from "@/components/pipeline/stage-tabs"
import { FileHubUploadButton } from "@/components/files/file-hub-upload-button"
import { SectionIntro } from "@/components/shell/section-intro"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import type { PipelineStage } from "@/lib/documents/stages"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

/** The one list shell every pipeline tab renders through — a header with the workspace-wide
 * upload entry point, tabs, a filter bar, then the table. A server component: the data (rows,
 * counts) is fetched by the page and handed down; only the list body, its bulk actions, and the
 * upload overlay need client interactivity. */
export function PipelineShell({ workspaceId, stage, counts, rows, contentMatches, query, flaggedOnly, documentSearchEnabled, upload }: {
  workspaceId: string
  stage: PipelineStage
  counts: Record<PipelineStage, number>
  rows: PipelineDocumentRow[]
  contentMatches: ContentMatchRow[]
  query: string
  flaggedOnly: boolean
  documentSearchEnabled: boolean
  upload: { fileId: string; templates: SheetTemplate[]; usage: WorkspaceUsage; sheetCount: number }
}) {
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">Extraction</h1>
          <SectionIntro section="extraction" workspaceId={workspaceId} />
        </div>
        <p className="text-sm text-slate-500">Upload, review, and approve documents — one list across every file.</p>
      </div>
      <div className="ml-auto">
        <FileHubUploadButton
          workspaceId={workspaceId}
          fileId={upload.fileId}
          fileName="Pipeline"
          template={upload.templates[0] ?? null}
          templates={upload.templates}
          usage={upload.usage}
          sheetCount={upload.sheetCount}
          documentSearchEnabled={documentSearchEnabled}
          primary />
      </div>
    </div>
    <StageTabs workspaceId={workspaceId} active={stage} counts={counts} />
    {stage === "ready" && counts.ready > 0 && <div className="flex items-center gap-2 border-b bg-emerald-50/60 px-6 py-2.5 text-[13px] text-emerald-800">
      <span className="font-medium">{counts.ready} approved document{counts.ready === 1 ? "" : "s"}</span>
      <span className="text-emerald-600">·</span>
      <Link href={`/workspaces/${workspaceId}/files?pick=new`} className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900">
        Next: use in Sheets <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>}
    <FilterPanel query={query} flaggedOnly={flaggedOnly} documentSearchEnabled={documentSearchEnabled} />
    <DocumentList workspaceId={workspaceId} stage={stage} rows={rows} contentMatches={contentMatches} query={query} />
  </div>
}
