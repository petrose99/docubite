"use client"

const UNITS: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "minute"], [3600, "hour"], [86_400, "day"], [604_800, "week"], [2_629_800, "month"], [31_557_600, "year"]]

export function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  let index = UNITS.length - 1
  while (index > 0 && seconds < UNITS[index][0]) index--
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.floor(seconds / UNITS[index][0]), UNITS[index][1])
}

/** "33 minutes ago" is computed from the clock, so the server's render and the client's hydration
 * land on different strings whenever a minute ticks over between them. The mismatch is expected
 * and harmless here, so it is suppressed rather than papered over with an absolute date; the exact
 * timestamp stays available in the tooltip. Shared by the Files browser and the pipeline list. */
export function LastUpdated({ iso }: { iso: string }) {
  return <time dateTime={iso} title={new Date(iso).toISOString()} suppressHydrationWarning>{relativeTime(iso)}</time>
}
