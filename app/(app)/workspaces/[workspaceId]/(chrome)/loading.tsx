export default function ChromeLoading() {
  return <div className="space-y-4 p-2" aria-busy="true" aria-label="Loading">
    <div className="h-8 w-56 animate-pulse rounded-md bg-stone-200" />
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-md border bg-white" />)}
    </div>
  </div>
}
