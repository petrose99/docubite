import type { DocumentFieldDefinition, FieldProvenanceHints, ProvenanceHint } from "@/lib/document-templates"
import type { MineruBlock, MineruPageSize } from "@/lib/mineru"
import { parsePageRange } from "@/lib/page-range"

/** Where a resolved value lives in the source document. `bbox` is a resolution-independent
 * [x0,y0,x1,y1] in the page's own 0-1 space, top-left origin — null when no usable rectangle was
 * found, in which case the viewer highlights the whole page instead. `score` records how well
 * the model's quote matched the block, so a weak match can be shown as approximate. */
export type Ref = {
  page: number
  bbox: [number, number, number, number] | null
  quote: string
  blockIndex: number | null
  score: number
}

/** The provenance record stored on a document: one Ref per scalar field, and one Ref (or null)
 * per row for array fields, index-aligned with the extracted rows. */
export type DocumentProvenance = {
  version: 1
  fields: Record<string, Ref>
  items: Record<string, (Ref | null)[]>
}

/** A quote is accepted as pinning a specific block only at or above this match score. Below it
 * the page is still trusted (the model's page claim) but the position is dropped to null. */
const ACCEPT_SCORE = 0.55

/** Lowercases, strips punctuation to spaces, and collapses whitespace, so a quote and the block
 * it came from compare on words alone — recognition noise around a value does not sink the match. */
export function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().replace(/\s+/g, " ")
}

function words(input: string): string[] {
  const normalized = normalizeForMatch(input)
  return normalized ? normalized.split(" ") : []
}

/** True when the whole `needle` word sequence appears as a contiguous run inside `hay`. Used for
 * the exact-substring case, on words rather than characters so a value like "9" cannot match
 * inside "99". */
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false
  for (let start = 0; start + needle.length <= hay.length; start++) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset++) {
      if (hay[start + offset] !== needle[offset]) { matched = false; break }
    }
    if (matched) return true
  }
  return false
}

/** Sørensen–Dice over two token multisets. */
function diceOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const counts = new Map<string, number>()
  for (const token of b) counts.set(token, (counts.get(token) ?? 0) + 1)
  let overlap = 0
  for (const token of a) {
    const remaining = counts.get(token) ?? 0
    if (remaining > 0) { overlap++; counts.set(token, remaining - 1) }
  }
  return (2 * overlap) / (a.length + b.length)
}

function wordBigrams(tokens: string[]): string[] {
  const bigrams: string[] = []
  for (let index = 0; index + 1 < tokens.length; index++) bigrams.push(`${tokens[index]} ${tokens[index + 1]}`)
  return bigrams
}

/** How well `query` (a quote or a value string) matches `text` (a parsed block). An exact word-run
 * match scores 1; otherwise a word-bigram Dice coefficient captures local word-order overlap,
 * falling back to a unigram overlap when either side is too short to form a bigram. */
export function scoreMatch(query: string, text: string): number {
  const q = words(query)
  const t = words(text)
  if (!q.length || !t.length) return 0
  if (containsRun(t, q)) return 1
  const qb = wordBigrams(q)
  const tb = wordBigrams(t)
  return qb.length && tb.length ? diceOverlap(qb, tb) : diceOverlap(q, t)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const round2 = (n: number) => Math.round(n * 100) / 100

/** Turns an extracted value into a plain string used as a fallback query when the model's quote
 * is paraphrased or missing — the printed value itself is often the most reliable thing to match. */
function valueToQuery(value: unknown): string {
  const flatten = (input: unknown): string[] => {
    if (input === null || input === undefined) return []
    if (typeof input === "number" || typeof input === "boolean") return [String(input)]
    if (typeof input === "string") return [input]
    if (Array.isArray(input)) return input.flatMap(flatten)
    if (typeof input === "object") return Object.values(input).flatMap(flatten)
    return []
  }
  return flatten(value).join(" ").slice(0, 300)
}

/** Normalises a block's pixel bbox into the page's 0-1 space, ordering the corners and clamping
 * to the page. Null when the block had no bbox or the page size is unknown. */
function normalizeBbox(bbox: [number, number, number, number] | null, size: MineruPageSize | null): [number, number, number, number] | null {
  if (!bbox || !size) return null
  const [x0, y0, x1, y1] = bbox
  const nx0 = clamp01(x0 / size.width)
  const nx1 = clamp01(x1 / size.width)
  const ny0 = clamp01(y0 / size.height)
  const ny1 = clamp01(y1 / size.height)
  return [Math.min(nx0, nx1), Math.min(ny0, ny1), Math.max(nx0, nx1), Math.max(ny0, ny1)]
}

type BlockMatch = { index: number; score: number; block: MineruBlock | null }

function bestInSet(query: string, valueStr: string, blocks: MineruBlock[], indices: number[]): BlockMatch {
  let best: BlockMatch = { index: -1, score: 0, block: null }
  for (const index of indices) {
    const block = blocks[index]
    const score = Math.max(query ? scoreMatch(query, block.text) : 0, valueStr ? scoreMatch(valueStr, block.text) : 0)
    if (score > best.score) best = { index, score, block }
  }
  return best
}

/** Searches for the block a value came from in widening rings: the hinted page first, then its
 * neighbours, then the whole document — stopping as soon as a ring produces an accepted match, so
 * a stronger-but-wrong match on a far page never displaces a good match on the page the model
 * named. Below the accept threshold everywhere, returns the global best for its score alone. */
function stagedBest(query: string, valueStr: string, blocks: MineruBlock[], hintPage: number | null): BlockMatch {
  const all = blocks.map((_, index) => index)
  if (hintPage === null) return bestInSet(query, valueStr, blocks, all)

  const onPage = all.filter((index) => blocks[index].page === hintPage)
  const onPageBest = bestInSet(query, valueStr, blocks, onPage)
  if (onPageBest.score >= ACCEPT_SCORE) return onPageBest

  const nearPage = all.filter((index) => Math.abs(blocks[index].page - hintPage) === 1)
  const nearBest = bestInSet(query, valueStr, blocks, nearPage)
  const nearOrOn = nearBest.score > onPageBest.score ? nearBest : onPageBest
  if (nearOrOn.score >= ACCEPT_SCORE) return nearOrOn

  const allBest = bestInSet(query, valueStr, blocks, all)
  return allBest.score > nearOrOn.score ? allBest : nearOrOn
}

/** Resolves one field's provenance hint against the parsed blocks into a concrete Ref, or null
 * when there is nothing to point at. An accepted quote match yields a page + bbox; a weak match
 * keeps the page but drops the bbox; with no blocks at all it degrades to the hinted page. */
export function resolveProvenance(
  hint: ProvenanceHint,
  value: unknown,
  blocks: MineruBlock[] | null,
  pageSizes: MineruPageSize[] | null,
): Ref | null {
  const quote = typeof hint.quote === "string" ? hint.quote.trim().slice(0, 300) : ""
  const valueStr = valueToQuery(value)
  const hintPage = Number.isInteger(hint.page) && (hint.page as number) > 0 ? (hint.page as number) : null

  const usable = Array.isArray(blocks) && blocks.length ? blocks : null
  if (usable && (quote || valueStr)) {
    const best = stagedBest(quote, valueStr, usable, hintPage)
    if (best.index >= 0 && best.block && best.score >= ACCEPT_SCORE) {
      const size = pageSizes?.find((page) => page.page === best.block!.page) ?? null
      return {
        page: best.block.page,
        bbox: normalizeBbox(best.block.bbox, size),
        quote: quote || best.block.text.slice(0, 300),
        blockIndex: best.index,
        score: round2(best.score),
      }
    }
    const page = hintPage ?? (best.block ? best.block.page : null)
    if (page === null) return null
    return { page, bbox: null, quote, blockIndex: null, score: best.index >= 0 ? round2(best.score) : 0 }
  }

  if (hintPage === null) return null
  return { page: hintPage, bbox: null, quote, blockIndex: null, score: 0 }
}

/** Rewrites a Ref's page from MinerU's 1..N numbering (over the *selected* pages) back to the
 * document's original page numbers. With a range of "3-5", MinerU's page 1 is the document's page
 * 3, so provenance a reviewer reads matches the page numbers printed on the document. */
export function remapPages(ref: Ref | null, pageRanges: string | null | undefined): Ref | null {
  if (!ref || !pageRanges?.trim()) return ref
  let original: number[] | null
  try {
    original = parsePageRange(pageRanges)
  } catch {
    return ref
  }
  if (!original) return ref
  const mapped = original[ref.page - 1]
  return mapped === undefined ? ref : { ...ref, page: mapped }
}

/** The parsed source, stored beside the document so a value can be re-located later. Block text is
 * capped so a text-heavy document cannot bloat the sidecar unboundedly. */
export type BlocksSidecar = {
  version: 1
  pages: MineruPageSize[]
  blocks: { page: number; bbox: [number, number, number, number] | null; text: string; type: string }[]
}

const MAX_BLOCK_TEXT = 2000
const MAX_SIDECAR_BYTES = 2 * 1024 * 1024

/** Builds the blocks sidecar, capping each block's text and trimming trailing blocks until the
 * whole thing fits the size ceiling. Null when there are no blocks worth storing. */
export function buildBlocksSidecar(blocks: MineruBlock[] | null, pageSizes: MineruPageSize[] | null): BlocksSidecar | null {
  if (!blocks?.length) return null
  const sidecar: BlocksSidecar = {
    version: 1,
    pages: pageSizes ?? [],
    blocks: blocks.map((block) => ({ page: block.page, bbox: block.bbox, text: block.text.slice(0, MAX_BLOCK_TEXT), type: block.type })),
  }
  while (sidecar.blocks.length && Buffer.byteLength(JSON.stringify(sidecar)) > MAX_SIDECAR_BYTES) {
    const next = Math.floor(sidecar.blocks.length * 0.9)
    sidecar.blocks = sidecar.blocks.slice(0, next < sidecar.blocks.length ? next : sidecar.blocks.length - 1)
  }
  return sidecar.blocks.length ? sidecar : null
}

/** Assembles the stored provenance record for a document: resolves each scalar field's merged
 * hint, and each array field's per-row hints, then remaps pages back to the original numbering.
 * Fields and rows with no locatable source are simply omitted (scalars) or nulled (rows). */
export function buildDocumentProvenance(
  fields: DocumentFieldDefinition[],
  hints: FieldProvenanceHints,
  extraction: Record<string, unknown>,
  blocks: MineruBlock[] | null,
  pageSizes: MineruPageSize[] | null,
  pageRanges: string | null | undefined,
): DocumentProvenance {
  const result: DocumentProvenance = { version: 1, fields: {}, items: {} }
  for (const field of fields) {
    if (field.type === "array") {
      const rows = Array.isArray(extraction[field.key]) ? (extraction[field.key] as unknown[]) : []
      if (!rows.length) continue
      const rowHints = hints.items[field.key] ?? []
      const refs = rows.map((row, index) => {
        const hint = rowHints[index]
        return hint ? remapPages(resolveProvenance(hint, row, blocks, pageSizes), pageRanges) : null
      })
      if (refs.some((ref) => ref !== null)) result.items[field.key] = refs
    } else {
      const hint = hints.fields[field.key]
      if (!hint || extraction[field.key] === undefined) continue
      const ref = remapPages(resolveProvenance(hint, extraction[field.key], blocks, pageSizes), pageRanges)
      if (ref) result.fields[field.key] = ref
    }
  }
  return result
}
