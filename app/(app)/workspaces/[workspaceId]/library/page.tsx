import { LibraryAskPanel } from "@/components/library/library-ask-panel"
import { LibraryFacetBar } from "@/components/library/library-facet-bar"
import { LibraryPagination } from "@/components/library/library-pagination"
import { LibraryPickList } from "@/components/library/library-pick-list"
import { LibraryDocumentGrid, LibraryDocumentList, LibrarySearchResults } from "@/components/library/library-results"
import { LibraryToolbar } from "@/components/library/library-toolbar"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { isValidScope, runLibrarySearch, type LibraryScope } from "@/lib/library-search"
import { listLibraryDocuments, summarizeDocumentForReview } from "@/models/documents"
import { listLibraryFacets } from "@/models/library-facets"
import { requireWorkspaceRole } from "@/models/workspaces"
import { FileText, Library } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

type SearchParams = {
  q?: string; scope?: string; mode?: string; page?: string
  type?: string; category?: string; supplier?: string
  from?: string; to?: string; flagged?: string
  view?: string; sort?: string; dir?: string; pick?: string
}

export default async function LibraryPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ workspaceId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()])
  await requireWorkspaceRole(workspaceId, user.id)

  const search = query.q?.trim() || ""
  const scope: LibraryScope = isValidScope(query.scope) ? query.scope : "smart"
  const pickMode = query.pick === "sheet"
  const aiMode = query.mode === "ai"
  const view = query.view === "list" ? "list" : "grid"
  const basePath = `/workspaces/${workspaceId}/library`
  const base = `/workspaces/${workspaceId}`

  const [facets, searchOutcome] = await Promise.all([
    listLibraryFacets(workspaceId),
    search ? runLibrarySearch(workspaceId, search, scope, user.id) : null,
  ])

  const isRanked = searchOutcome?.kind === "ranked"

  const listFilters = {
    ...(isRanked ? { documentIds: searchOutcome.orderedIds } : {}),
    ...(!isRanked && searchOutcome?.kind === "filter" ? searchOutcome.filters : {}),
    ...(query.type ? { templateId: query.type } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.supplier ? { supplier: query.supplier } : {}),
    ...(query.from ? { receivedFrom: new Date(query.from) } : {}),
    ...(query.to ? { receivedTo: new Date(query.to + "T23:59:59") } : {}),
    ...(query.flagged === "1" ? { flagged: true } : {}),
    ...(!isRanked ? {
      sort: (query.sort === "filename" ? "filename" : "receivedAt") as "receivedAt" | "filename",
      dir: (query.dir === "asc" ? "asc" : "desc") as "asc" | "desc",
      page: Math.max(parseInt(query.page ?? "1", 10) || 1, 1),
    } : {}),
  }

  const { documents: rawDocs, total, page, pageCount } = await listLibraryDocuments(workspaceId, listFilters)

  const documents = rawDocs.map((doc) => ({
    id: doc.id,
    filename: doc.filename,
    receivedAt: doc.receivedAt,
    flaggedAt: doc.flaggedAt ?? null,
    template: doc.template ? { code: doc.template.code, name: doc.template.name } : null,
    review: summarizeDocumentForReview(doc),
  }))

  const baseParams: Record<string, string> = {}
  if (search) baseParams.q = search
  if (query.scope && query.scope !== "smart") baseParams.scope = query.scope
  if (query.type) baseParams.type = query.type
  if (query.category) baseParams.category = query.category
  if (query.supplier) baseParams.supplier = query.supplier
  if (query.from) baseParams.from = query.from
  if (query.to) baseParams.to = query.to
  if (query.flagged === "1") baseParams.flagged = "1"
  if (view === "list") baseParams.view = "list"
  if (query.sort) baseParams.sort = query.sort
  if (query.dir) baseParams.dir = query.dir
  if (pickMode) baseParams.pick = "sheet"
  if (aiMode) baseParams.mode = "ai"

  return (
    <div className={`flex h-full ${aiMode ? "" : ""}`}>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 md:px-6">
        <header>
          <div className="flex items-center gap-2">
            <Library className="h-5 w-5 text-emerald-600" />
            <h1 className="text-xl font-bold text-slate-900">
              {pickMode ? "Select documents for your sheet" : "Docu Library"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {pickMode
              ? "Pick the documents you want — the sheet will use their extracted fields as columns."
              : "Every document that's been through extraction — browse, search, and pull into Sheets."}
          </p>
        </header>

        <LibraryToolbar
          query={search}
          scope={scope}
          view={view}
          flagged={query.flagged === "1"}
          pickMode={pickMode}
          embeddingsEnabled={config.embeddings.enabled}
        />

        <LibraryFacetBar
          facets={facets}
          activeType={query.type ?? null}
          activeCategory={query.category ?? null}
          activeSupplier={query.supplier ?? null}
          activeFrom={query.from ?? null}
          activeTo={query.to ?? null}
          baseParams={baseParams}
          basePath={basePath}
        />

        {documents.length > 0 ? (
          pickMode ? (
            <LibraryPickList
              workspaceId={workspaceId}
              documents={documents.map((doc) => ({
                id: doc.id,
                filename: doc.filename,
                supplier: doc.review.supplier,
                category: doc.review.category,
                total: doc.review.total,
                templateName: doc.template?.name ?? null,
              }))}
            />
          ) : isRanked ? (
            <LibrarySearchResults
              documents={documents}
              snippets={searchOutcome.snippets}
              query={search}
              degraded={searchOutcome.degraded}
              basePath={base}
            />
          ) : view === "grid" ? (
            <LibraryDocumentGrid documents={documents} basePath={base} />
          ) : (
            <LibraryDocumentList documents={documents} basePath={base} />
          )
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-500">
              {search ? "No documents match your search." : "Nothing here yet."}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {search ? (
                <>Try a different query or <Link href={basePath} className="text-emerald-600 underline">clear filters</Link>.</>
              ) : "Documents will appear here after extraction."}
            </p>
          </div>
        )}

        {!isRanked && (
          <LibraryPagination
            page={page}
            pageCount={pageCount}
            total={total}
            baseParams={baseParams}
            basePath={basePath}
          />
        )}
      </main>

      {aiMode && <LibraryAskPanel workspaceId={workspaceId} query={search} />}
    </div>
  )
}
