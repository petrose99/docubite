export type PageSignal = {
  pageNumber: number
  text: string
  hasHeader?: boolean
  hasFooter?: boolean
  pageCount?: number
}

export type DetectedBoundary = {
  startPage: number
  endPage: number
  confidence: number
  reason: string
}

const HEADER_PATTERNS = [
  /\binvoice\b/i,
  /\bstatement\b/i,
  /\breceipt\b/i,
  /\bpurchase\s+order\b/i,
  /\bcredit\s+note\b/i,
  /\bdelivery\s+note\b/i,
  /\bquotation\b/i,
  /\bproforma\b/i,
]

const PAGE_NUMBER_PATTERNS = [
  /\bpage\s+1\s+(of|\/)\s+\d+/i,
  /^\s*1\s*\/\s*\d+\s*$/m,
  /\b1\s+of\s+\d+\b/i,
]

const TOTAL_PATTERNS = [
  /\btotal\b.*[£$€]\s*[\d,.]+/i,
  /\bamount\s+due\b/i,
  /\bbalance\s+due\b/i,
  /\bgrand\s+total\b/i,
]

export function detectBoundaries(pages: PageSignal[]): DetectedBoundary[] {
  if (pages.length <= 1) {
    return [{ startPage: 1, endPage: pages.length, confidence: 1, reason: "single_page" }]
  }

  const scores = pages.map((page, i) => ({
    page: page.pageNumber,
    isStart: computeStartScore(page, i, pages),
    isEnd: computeEndScore(page, i, pages),
  }))

  const boundaries: DetectedBoundary[] = []
  let currentStart = 0

  for (let i = 1; i < scores.length; i++) {
    const prevEnd = scores[i - 1].isEnd
    const currStart = scores[i].isStart
    const combined = (prevEnd + currStart) / 2

    if (combined >= 0.4) {
      boundaries.push({
        startPage: pages[currentStart].pageNumber,
        endPage: pages[i - 1].pageNumber,
        confidence: combined,
        reason: describeSignals(scores[i - 1], scores[i]),
      })
      currentStart = i
    }
  }

  boundaries.push({
    startPage: pages[currentStart].pageNumber,
    endPage: pages[pages.length - 1].pageNumber,
    confidence: currentStart === 0 ? 0.5 : scores[currentStart].isStart,
    reason: currentStart === 0 ? "remainder" : "final_segment",
  })

  return boundaries
}

function computeStartScore(page: PageSignal, index: number, all: PageSignal[]): number {
  if (index === 0) return 1
  let score = 0

  for (const pattern of HEADER_PATTERNS) {
    if (pattern.test(page.text.slice(0, 500))) { score += 0.3; break }
  }

  for (const pattern of PAGE_NUMBER_PATTERNS) {
    if (pattern.test(page.text)) { score += 0.4; break }
  }

  if (page.hasHeader && !all[index - 1]?.hasHeader) score += 0.2

  const prevText = all[index - 1]?.text ?? ""
  const currFirst200 = page.text.slice(0, 200).toLowerCase()
  const prevFirst200 = prevText.slice(0, 200).toLowerCase()
  if (currFirst200 && prevFirst200) {
    const overlap = jaccardSimilarity(currFirst200, prevFirst200)
    if (overlap < 0.1) score += 0.2
  }

  return Math.min(score, 1)
}

function computeEndScore(page: PageSignal, index: number, all: PageSignal[]): number {
  if (index === all.length - 1) return 1
  let score = 0

  for (const pattern of TOTAL_PATTERNS) {
    if (pattern.test(page.text.slice(-500))) { score += 0.3; break }
  }

  const pageNumMatch = page.text.match(/page\s+(\d+)\s+of\s+(\d+)/i)
  if (pageNumMatch && pageNumMatch[1] === pageNumMatch[2]) score += 0.5

  if (page.text.trim().length < 200 && index > 0 && all[index - 1].text.trim().length > 500) {
    score += 0.1
  }

  return Math.min(score, 1)
}

function describeSignals(prev: { isEnd: number }, curr: { isStart: number }): string {
  const parts: string[] = []
  if (prev.isEnd >= 0.3) parts.push("prev_page_looks_like_end")
  if (curr.isStart >= 0.3) parts.push("curr_page_looks_like_start")
  return parts.join("+") || "heuristic"
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter(Boolean))
  const setB = new Set(b.split(/\s+/).filter(Boolean))
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const word of setA) if (setB.has(word)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function boundariesToPageRanges(boundaries: DetectedBoundary[]): string[] {
  return boundaries.map((b) =>
    b.startPage === b.endPage ? String(b.startPage) : `${b.startPage}-${b.endPage}`
  )
}
