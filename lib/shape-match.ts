/** A document's layout fingerprint, used to recognise the next upload of the same kind. `tokens`
 * is the bag of its most frequent words (order-free, for overlap); `headTokens` is the first run
 * of words in reading order (for layout, since two different documents rarely share a header
 * sequence); `docType`/`entity` are the classification labels when known. */
export type ShapeSignature = { tokens: string[]; headTokens: string[]; docType: string; entity: string }

/** How much of the first page is fingerprinted. Column layout and headers live at the top; reading
 * further only lets body text drown out the structural words that identify the document kind. */
const SIGNATURE_CHARS = 1500
const MAX_TOKENS = 64
const MAX_HEAD_TOKENS = 30
const MIN_TOKEN_LENGTH = 3

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().replace(/\s+/g, " ")
}

function tokenize(text: string): string[] {
  const normalized = normalize(text.slice(0, SIGNATURE_CHARS))
  return normalized ? normalized.split(" ").filter((word) => word.length >= MIN_TOKEN_LENGTH) : []
}

/** Builds a signature from a document's first-page text and, when known, its classification. */
export function buildShapeSignature(input: { firstPageText: string; docType?: string | null; entity?: string | null }): ShapeSignature {
  const words = tokenize(input.firstPageText)
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  const tokens = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_TOKENS).map(([word]) => word)
  const headTokens: string[] = []
  const seen = new Set<string>()
  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    headTokens.push(word)
    if (headTokens.length >= MAX_HEAD_TOKENS) break
  }
  return { tokens, headTokens, docType: normalize(input.docType ?? ""), entity: normalize(input.entity ?? "") }
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let intersection = 0
  const setA = new Set(a)
  for (const token of setA) if (setB.has(token)) intersection++
  const union = setA.size + setB.size - intersection
  return union ? intersection / union : 0
}

/** Length of the longest common subsequence of two token lists — order-preserving overlap. */
function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const previous = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0
    for (let j = 1; j <= b.length; j++) {
      const temporary = previous[j]
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(previous[j], previous[j - 1])
      diagonal = temporary
    }
  }
  return previous[b.length]
}

function orderedOverlap(a: string[], b: string[]): number {
  const longest = Math.max(a.length, b.length)
  return longest ? lcsLength(a, b) / longest : 0
}

/** How alike two signatures are, in [0, 1]. Weighted toward the frequent-token overlap, with the
 * header order and the classification labels as corroborating signals. */
export function scoreShapeMatch(a: ShapeSignature, b: ShapeSignature): number {
  const docTypeEq = a.docType && b.docType && a.docType === b.docType ? 1 : 0
  const entityEq = a.entity && b.entity && a.entity === b.entity ? 1 : 0
  return 0.55 * jaccard(a.tokens, b.tokens) + 0.25 * orderedOverlap(a.headTokens, b.headTokens) + 0.15 * docTypeEq + 0.05 * entityEq
}

/** The accept threshold, raised when the probe carries no classification labels: with less signal
 * to go on, a match has to be that much more certain before it is offered. */
const MATCH_THRESHOLD = 0.62
const LABELLESS_THRESHOLD = 0.68
/** Two candidates this close are treated as a tie, and a tie resolves to no match — a wrong
 * silence is recoverable (the user sets the sheet up themselves), a wrong auto-apply is not. */
const AMBIGUITY_MARGIN = 0.05

/** Picks the one saved shape a probe matches, or null when nothing clears the threshold or two
 * candidates are too close to choose between. Deterministic: no LLM tie-break, by design. */
export function matchShape<T extends { signature: ShapeSignature }>(candidates: T[], probe: ShapeSignature): T | null {
  if (!candidates.length) return null
  const scored = candidates.map((candidate) => ({ candidate, score: scoreShapeMatch(candidate.signature, probe) })).sort((a, b) => b.score - a.score)
  const threshold = probe.docType || probe.entity ? MATCH_THRESHOLD : LABELLESS_THRESHOLD
  if (scored[0].score < threshold) return null
  if (scored[1] && scored[0].score - scored[1].score < AMBIGUITY_MARGIN) return null
  return scored[0].candidate
}
