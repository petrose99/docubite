/** One document as the deduper sees it: its content hash, some text to shingle, and its period so
 * a legitimate recurring monthly is not mistaken for a copy. */
export type DedupeDoc = { id: string; filename: string; sha256: string; text: string; period: string }

/** A pair of documents the report flags: byte-identical ("exact") or near-identical ("near", e.g.
 * a re-scan of the same page). Score is 1 for exact, the shingle Jaccard for near. */
export type DuplicatePair = { a: string; b: string; aFilename: string; bFilename: string; kind: "exact" | "near"; score: number }

const SHINGLE_SIZE = 5
const TEXT_LIMIT = 20_000
/** A near-duplicate has to be this similar. High on purpose: two documents of the same kind share
 * a lot of boilerplate, and only a genuine re-scan clears this bar. */
const NEAR_THRESHOLD = 0.92

function normalize(text: string): string {
  return text.slice(0, TEXT_LIMIT).toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().replace(/\s+/g, " ")
}

/** The set of 5-word shingles of a document's text — its content fingerprint for near-duplicate
 * detection. A single-shingle document (fewer than 5 words) yields the whole thing as one shingle. */
export function shingleSet(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = normalize(text).split(" ").filter(Boolean)
  if (!words.length) return new Set()
  if (words.length < size) return new Set([words.join(" ")])
  const shingles = new Set<string>()
  for (let index = 0; index + size <= words.length; index++) shingles.add(words.slice(index, index + size).join(" "))
  return shingles
}

/** Jaccard overlap of two shingle sets, in [0, 1]. */
export function nearDupeScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const shingle of small) if (large.has(shingle)) intersection++
  const union = a.size + b.size - intersection
  return union ? intersection / union : 0
}

/** True when two periods are safe to treat as duplicates: the same period, or both absent. Two
 * documents that differ only in period (January vs February) are a recurring series, not copies. */
function periodsMatch(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

/** Finds duplicate pairs in a batch: byte-identical files by sha256, and near-identical ones by
 * shingle overlap — the latter guarded by period, so this month's statement and last month's are
 * never flagged just for sharing a template. Pairwise over a batch, which is small by construction. */
export function findDuplicates(docs: DedupeDoc[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  const shingles = docs.map((doc) => shingleSet(doc.text))
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i]
      const b = docs[j]
      if (a.sha256 && a.sha256 === b.sha256) {
        pairs.push({ a: a.id, b: b.id, aFilename: a.filename, bFilename: b.filename, kind: "exact", score: 1 })
        continue
      }
      if (!periodsMatch(a.period, b.period)) continue
      const score = nearDupeScore(shingles[i], shingles[j])
      if (score >= NEAR_THRESHOLD) pairs.push({ a: a.id, b: b.id, aFilename: a.filename, bFilename: b.filename, kind: "near", score })
    }
  }
  return pairs
}
