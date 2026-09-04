import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

export function paginationWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = []
  pages.push(1)
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push("ellipsis")
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push("ellipsis")
  pages.push(total)
  return pages
}

export function LibraryPagination({ page, pageCount, total, baseParams, basePath }: {
  page: number
  pageCount: number
  total: number
  baseParams: Record<string, string>
  basePath: string
}) {
  if (pageCount <= 1) return null

  const buildHref = (p: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(baseParams)) { if (v) params.set(k, v) }
    if (p > 1) params.set("page", String(p)); else params.delete("page")
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const window = paginationWindow(page, pageCount)

  return (
    <nav className="flex items-center justify-between" aria-label="Pagination">
      <p className="text-xs text-slate-400">
        {total} document{total !== 1 ? "s" : ""} · page {page} of {pageCount}
      </p>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100" aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span className="rounded-md p-1.5 text-slate-300" aria-disabled><ChevronLeft className="h-4 w-4" /></span>
        )}

        {window.map((item, i) =>
          item === "ellipsis" ? (
            <span key={`e${i}`} className="px-1.5 text-xs text-slate-300">…</span>
          ) : (
            <Link
              key={item}
              href={buildHref(item)}
              aria-current={item === page ? "page" : undefined}
              className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                item === page ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item}
            </Link>
          ),
        )}

        {page < pageCount ? (
          <Link href={buildHref(page + 1)} className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className="rounded-md p-1.5 text-slate-300" aria-disabled><ChevronRight className="h-4 w-4" /></span>
        )}
      </div>
    </nav>
  )
}
