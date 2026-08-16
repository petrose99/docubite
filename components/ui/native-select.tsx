import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"
import * as React from "react"

/** A native <select> dressed to match Input, with the platform arrow replaced by a lucide chevron
 * so it does not stand out as the one unstyled control on the page.
 *
 * Deliberately native rather than a Radix listbox: the project installs only react-label,
 * react-popover and react-slot, and a role picker is not worth a new dependency — the native
 * control also gets keyboard and mobile behaviour for free. */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm shadow-sm transition-[color,border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
