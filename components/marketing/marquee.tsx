/** Infinite horizontal marquee. Server component: the track is duplicated at render time and the
 * CSS animation (.marquee-track, app/globals.css) shifts it by exactly -50%, so no client JS is
 * needed to loop it. Reduced motion collapses to a single static, wrapping list. */
export function Marquee({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="flex w-max gap-3 motion-reduce:w-full motion-reduce:flex-wrap marquee-track motion-reduce:animate-none">
        <div className="flex shrink-0 items-center gap-3 motion-reduce:flex-wrap">{children}</div>
        <div className="flex shrink-0 items-center gap-3 motion-reduce:hidden" aria-hidden="true">{children}</div>
      </div>
    </div>
  )
}
