/** Shaped like the spreadsheet that replaces it — file bar, toolbar, then a grid to the edges
 * — so the page does not visibly rearrange itself the moment the real one arrives. */
export default function SheetLoading() {
  return <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading spreadsheet">
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <div className="h-6 w-16 animate-pulse rounded bg-slate-200" />
      <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
      <div className="ml-auto h-7 w-20 animate-pulse rounded-md bg-slate-200" />
    </div>
    <div className="flex items-center gap-2 border-b px-3 py-2">
      {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-6 w-6 animate-pulse rounded bg-slate-100" />)}
      <div className="h-6 w-24 animate-pulse rounded bg-slate-100" />
    </div>
    <div className="min-h-0 flex-1 bg-white">
      <div className="h-7 animate-pulse border-b bg-slate-100" />
      {Array.from({ length: 12 }).map((_, index) => <div key={index} className="flex h-7 border-b">
        <div className="w-10 shrink-0 animate-pulse bg-slate-50" />
        <div className="flex-1" />
      </div>)}
    </div>
  </div>
}
