import { LibraryPickList } from "@/components/library/library-pick-list"
import { SectionIntro } from "@/components/shell/section-intro"
import { getCurrentUser } from "@/lib/auth"
import { summarizeDocumentForReview } from "@/models/documents"
import { listWorkspaceDocuments } from "@/models/documents"
import { requireWorkspaceRole } from "@/models/workspaces"
import { FileText, ChevronRight } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

const STAGE_TABS = [
  { key: "ready", label: "Approved" },
  { key: "archive", label: "Archived" },
] as const

export default async function LibraryPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ stage?: string; q?: string; pick?: string }>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const stage = query.stage === "archive" ? "archive" as const : "ready" as const
  const search = query.q?.trim() || ""
  const pickMode = query.pick === "sheet"

  const documents = await listWorkspaceDocuments(workspaceId, {
    stage,
    ...(search ? { query: search } : {}),
  })

  const base = `/workspaces/${workspaceId}`

  const pickParam = pickMode ? "&pick=sheet" : ""

  return <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
    <header>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900">{pickMode ? "Select documents for your sheet" : "Docu Library"}</h1>
        {!pickMode && <SectionIntro section="library" workspaceId={workspaceId} />}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {pickMode
          ? "Pick the documents you want — the sheet will use their extracted fields as columns."
          : "Every approved document in one place — browse, search, and pull into Sheets."}
      </p>
    </header>

    <div className="flex items-center gap-4">
      <nav className="flex items-center gap-1 text-sm">
        {STAGE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`${base}/library${tab.key === "ready" ? "" : `?stage=${tab.key}`}${tab.key === "ready" ? (pickParam ? `?pick=sheet` : "") : pickParam}`}
            className={`rounded-md px-2.5 py-1 font-medium ${stage === tab.key ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <form action="" className="ml-auto">
        {pickMode && <input type="hidden" name="pick" value="sheet" />}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search documents..."
          className="w-64 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
      </form>
    </div>

    {documents.length > 0 ? (
      pickMode ? (
        <LibraryPickList
          workspaceId={workspaceId}
          stage={stage}
          documents={documents.map((doc) => {
            const review = summarizeDocumentForReview(doc)
            return {
              id: doc.id,
              filename: doc.filename,
              supplier: review.supplier,
              category: review.category,
              total: review.total,
              templateName: doc.template?.name ?? null,
            }
          })}
        />
      ) : (
        <div className="divide-y rounded-xl border border-[#e6ebf1] bg-white shadow-panel">
          {documents.map((doc) => {
            const review = summarizeDocumentForReview(doc)
            return (
              <Link
                key={doc.id}
                href={`${base}/documents/${doc.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500">
                  <FileText className="h-[17px] w-[17px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">
                    {review.supplier ?? "Unknown supplier"}
                    {review.category ? ` · ${review.category}` : ""}
                  </div>
                  <div className="text-xs text-slate-400">
                    {doc.filename}
                    {review.total ? ` · ${review.total}` : ""}
                    {doc.template ? ` · ${doc.template.name}` : ""}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  stage === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {stage === "ready" ? "Approved" : "Archived"}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            )
          })}
        </div>
      )
    ) : (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-500">
          {search ? "No documents match your search." : "Nothing here yet."}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {search ? "Try a different query." : "Approve a document in Extraction to see it here."}
        </p>
      </div>
    )}
  </main>
}
