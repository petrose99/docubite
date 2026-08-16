/** Parses a Lido-style page range ("1-3,5") into a sorted, deduplicated list of page numbers.
 * Returns null for blank input, meaning "all pages". Throws on anything unparseable so the
 * caller can reject the input before it is frozen onto a document. */
export function parsePageRange(input: string | null | undefined): number[] | null {
  const trimmed = input?.trim()
  if (!trimmed) return null
  const pages = new Set<number>()
  for (const part of trimmed.split(",")) {
    const piece = part.trim()
    if (!piece) continue
    const match = piece.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error("invalid_page_range")
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (start < 1 || end < start || end - start >= 5000) throw new Error("invalid_page_range")
    for (let page = start; page <= end; page++) pages.add(page)
  }
  if (!pages.size) return null
  return [...pages].sort((a, b) => a - b)
}

/** Renders a page list back into the compact "1-3,5" form, collapsing consecutive runs. */
export function formatPageRange(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index]
    while (index + 1 < sorted.length && sorted[index + 1] === sorted[index] + 1) index++
    parts.push(start === sorted[index] ? String(start) : `${start}-${sorted[index]}`)
  }
  return parts.join(",")
}
