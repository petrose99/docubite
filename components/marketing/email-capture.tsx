import { cn } from "@/lib/utils"
import { ArrowRight } from "lucide-react"

/** The trial funnel's front door, in the nav, the hero and the closing band.
 *
 * A native GET form to /signup rather than a client component with a router.push: the browser
 * already serialises the field into `?email=`, which is exactly the query the signup form reads
 * to prefill itself. No JavaScript, so it works on the first paint of the page. */
export function EmailCapture({ size = "default", tone = "light", className, label = "Start free trial" }: {
  size?: "default" | "lg"
  tone?: "light" | "inverse"
  className?: string
  label?: string
}) {
  const large = size === "lg"
  return (
    <form action="/signup" method="get" className={cn("flex w-full flex-col gap-2 sm:flex-row", className)}>
      <label className="sr-only" htmlFor={`trial-email-${size}-${tone}`}>Work email</label>
      <input
        id={`trial-email-${size}-${tone}`}
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="Enter your work email"
        className={cn(
          "min-w-0 flex-1 rounded-lg border bg-white px-3.5 text-stone-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-stone-400 focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/25",
          large ? "h-12 text-base" : "h-9 text-sm",
          tone === "inverse" ? "border-transparent" : "border-stone-300",
        )}
      />
      <button
        type="submit"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-2 active:translate-y-px",
          large ? "h-12 px-6 text-base" : "h-9 px-4 text-sm",
          tone === "inverse" && "bg-white text-emerald-900 hover:bg-emerald-50",
        )}
      >
        {label}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  )
}
