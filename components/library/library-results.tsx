import { highlightSnippet } from "@/components/shared/highlight-snippet"
import type { DocumentReviewSummary } from "@/models/documents"
import { AlertTriangle, ChevronRight, FileText, Flag, Receipt, FileSpreadsheet, Landmark, ScrollText } from "lucide-react"
import Link from "next/link"

type LibraryDocRow = {
  id: string
  filename: string
  receivedAt: Date
  flaggedAt: Date | null
  template: { code: string; name: string } | null
  review: DocumentReviewSummary
}

const TEMPLATE_ICONS: Record<string, typeof FileText> = {
  invoice: Receipt,
  receipt: Receipt,
  expense_receipt: Receipt,
  bank_statement: Landmark,
  purchase_order: ScrollText,
  remittance_advice: FileSpreadsheet,
  supplier_statement: FileSpreadsheet,
}

function DocIcon({ templateCode }: { templateCode: string | null }) {
  const Icon = (templateCode && TEMPLATE_ICONS[templateCode]) || FileText
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
      <Icon className="h-5 w-5" />
    </span>
  )
}

function TemplateBadge({ name }: { name: string }) {
  return <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">{name}</span>
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
}

export function LibraryDocumentGrid({ documents, basePath }: { documents: LibraryDocRow[]; basePath: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {documents.map((doc) => (
        <Link
          key={doc.id}
          href={`${basePath}/documents/${doc.id}`}
          className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
        >
          <div className="flex items-start gap-3">
            <DocIcon templateCode={doc.template?.code ?? null} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-emerald-700">
                {doc.review.supplier ?? "Unknown supplier"}
              </p>
              <p className="truncate text-xs text-slate-400">{doc.filename}</p>
            </div>
            {doc.flaggedAt && <Flag className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {doc.template && <TemplateBadge name={doc.template.name} />}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{doc.review.category}</span>
          </div>
          <div className="mt-auto flex items-center justify-between text-xs text-slate-400">
            <span>{formatDate(doc.receivedAt)}</span>
            {doc.review.total && <span className="font-semibold text-slate-700">{doc.review.total}</span>}
          </div>
        </Link>
      ))}
    </div>
  )
}

export function LibraryDocumentList({ documents, basePath }: { documents: LibraryDocRow[]; basePath: string }) {
  return (
    <div className="divide-y rounded-xl border border-slate-200 bg-white shadow-sm">
      {documents.map((doc) => (
        <Link
          key={doc.id}
          href={`${basePath}/documents/${doc.id}`}
          className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
        >
          <DocIcon templateCode={doc.template?.code ?? null} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-800">
                {doc.review.supplier ?? "Unknown supplier"}
              </span>
              {doc.template && <TemplateBadge name={doc.template.name} />}
              {doc.flaggedAt && <Flag className="h-3 w-3 text-amber-400" />}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="truncate">{doc.filename}</span>
              <span>·</span>
              <span>{doc.review.category}</span>
              {doc.review.total && <><span>·</span><span className="font-medium text-slate-600">{doc.review.total}</span></>}
              <span>·</span>
              <span>{formatDate(doc.receivedAt)}</span>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
        </Link>
      ))}
    </div>
  )
}

export function LibrarySearchResults({ documents, snippets, query, degraded, basePath }: {
  documents: LibraryDocRow[]
  snippets: Map<string, { text: string; page: number | null }>
  query: string
  degraded: boolean
  basePath: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-medium">Top {documents.length} matches</span>
        {degraded && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            Semantic search unavailable — matching text only
          </span>
        )}
      </div>

      <div className="divide-y rounded-xl border border-slate-200 bg-white shadow-sm">
        {documents.map((doc) => {
          const snippet = snippets.get(doc.id)
          return (
            <Link
              key={doc.id}
              href={`${basePath}/documents/${doc.id}`}
              className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-slate-50"
            >
              <DocIcon templateCode={doc.template?.code ?? null} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">
                    {doc.review.supplier ?? doc.filename}
                  </span>
                  {doc.template && <TemplateBadge name={doc.template.name} />}
                  {snippet?.page != null && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">p.{snippet.page}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{doc.review.category}</span>
                  {doc.review.total && <><span>·</span><span className="font-medium text-slate-600">{doc.review.total}</span></>}
                  <span>·</span>
                  <span>{formatDate(doc.receivedAt)}</span>
                </div>
                {snippet && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {highlightSnippet(snippet.text, query)}
                  </p>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
