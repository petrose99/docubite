"use client"

import { ChevronDown, FileSearch, FileText, Loader2 } from "lucide-react"
import { useState } from "react"

/** One source the assistant surfaced, in the shape the click-through into the document viewer
 * needs: which document, the page to open at, the highlight rectangle (null when the chunk spans
 * more than one page), and the snippet to quote. */
export type SourceHit = {
  documentId: string
  filename: string
  page: number | null
  bbox: [number, number, number, number] | null
  snippet: string
}

/** The search tool's parts as they arrive over the AI SDK stream. The client shares no server
 * type, so `input`/`output` are narrowed defensively before anything is dereferenced. */
type SearchInput = { query?: unknown } | undefined
type SearchOutput = { results?: unknown; error?: unknown; pendingIndexing?: unknown } | undefined
type PartState = "input-streaming" | "input-available" | "output-available" | "output-error"

/** The server caps at 8; the client caps again so a misbehaving stream can never render a wall. */
const MAX_ROWS = 8

function toHits(results: unknown): SourceHit[] {
  if (!Array.isArray(results)) return []
  return results
    .flatMap((entry): SourceHit[] => {
      if (!entry || typeof entry !== "object") return []
      const row = entry as Record<string, unknown>
      if (typeof row.documentId !== "string" || typeof row.filename !== "string") return []
      const page = typeof row.page === "number" ? row.page : null
      const bbox =
        Array.isArray(row.bbox) && row.bbox.length === 4 && row.bbox.every((n) => typeof n === "number")
          ? (row.bbox as [number, number, number, number])
          : null
      const snippet = typeof row.snippet === "string" ? row.snippet : ""
      return [{ documentId: row.documentId, filename: row.filename, page, bbox, snippet }]
    })
    .slice(0, MAX_ROWS)
}

/** Keeps the start of a filename and its extension, eliding the middle â€” so a long
 * "2024-acme-quarterly-invoice-final.pdf" still shows what kind of file it is at a glance. The CSS
 * `truncate` on the row is the backstop; this is what preserves the extension when it does bite. */
export function middleTruncate(name: string, max = 42): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf(".")
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : ""
  const head = Math.max(4, max - ext.length - 1)
  return `${name.slice(0, head)}â€¦${ext}`
}

/** Renders the `search_documents` tool part in the assistant transcript, by AI SDK part state.
 * Running â†’ a shimmer with the query; degraded â†’ one quiet stone line (the turn still answered
 * from the grid); empty â†’ a one-liner, tuned when documents are still indexing; results â†’ the
 * Sources card, white with a stone border because these are evidence, not a change the assistant
 * made. Every row is click-through into the document viewer via `onOpenSource`. */
export function DocumentSearchPart({ state, input, output, onOpenSource }: {
  state: PartState
  input: SearchInput
  output: SearchOutput
  onOpenSource?: (hit: SourceHit) => void
}) {
  const [open, setOpen] = useState(true)
  const query = typeof input?.query === "string" ? input.query : ""

  if (state === "input-streaming" || state === "input-available") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        {query ? `Searching documents for â€œ${query}â€` : "Searching documentsâ€¦"}
      </p>
    )
  }

  if (state === "output-error" || Boolean(output && "error" in output && output.error)) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <FileSearch className="h-3 w-3 shrink-0" />
        Document search is unavailable right now â€” answering from the sheet only.
      </p>
    )
  }

  const hits = toHits(output?.results)

  if (!hits.length) {
    const pending = Boolean(output?.pendingIndexing)
    return (
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <FileSearch className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          {pending
            ? "No matches yet â€” some documents are still being indexed. Try again in a minute."
            : query
              ? `Searched documents for â€œ${query}â€ â€” no matching passages.`
              : "Searched documents â€” no matching passages."}
        </span>
      </p>
    )
  }

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700">
        <FileSearch className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        Sources
        <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-500">{hits.length}</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <ul className="border-t">
          {hits.map((hit, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => onOpenSource?.(hit)}
                title={hit.page != null ? `Open ${hit.filename} at page ${hit.page}` : `Open ${hit.filename}`}
                className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-slate-50">
                <span className="flex w-full items-center gap-1.5">
                  <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{middleTruncate(hit.filename)}</span>
                  {hit.page != null && (
                    <span className="shrink-0 rounded bg-emerald-50 px-1 font-mono text-[11px] text-emerald-800">p.{hit.page}</span>
                  )}
                </span>
                {hit.snippet && <span className="line-clamp-2 text-[11px] text-slate-500">{hit.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
