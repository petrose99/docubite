import { cn } from "@/lib/utils"

export function ColoredText({
  children,
  className,
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    // amber-500 here is the last stop of a decorative orange->amber text gradient, not a
    // status/warning accent, so it is left as-is rather than converted to indigo (which would
    // break the gradient's warm color progression).
    <span className={cn("bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500 bg-clip-text text-transparent", className)}>
      {children}
    </span>
  )
}
