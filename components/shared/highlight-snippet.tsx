import type { ReactNode } from "react"

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Marks a search query's words in a snippet — case-insensitive, whole-run — so the reason a
 * document matched is visible. Pure: splits on a capture group so matched runs land at odd
 * indices. Shared by the Files browser's content search and the pipeline list's. */
export function highlightSnippet(snippet: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter((word) => word.length >= 2)
  if (!words.length) return snippet
  const re = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi")
  return snippet.split(re).map((segment, index) =>
    index % 2 === 1 ? <mark key={index} className="rounded-sm bg-amber-100 text-inherit">{segment}</mark> : segment,
  )
}
