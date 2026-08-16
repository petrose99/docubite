/** One document as the report sees it: how it was classified, its status, and its confidence
 * record (the missing/conflicting fields extraction already worked out). */
export type ReportDoc = {
  id: string
  filename: string
  shapeId: string | null
  docType: string
  entity: string
  period: string
  status: string
  confidence: { missingRequiredFields?: string[]; conflictingFields?: string[] } | null
}

export type DocumentGroup = { key: string; docType: string; entity: string; documentIds: string[]; periods: string[] }
export type Issue = { documentId: string; filename: string; message: string; fieldKey?: string }

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Groups documents by what they are: their shape when they have one, else their classification
 * (doc type + entity). This is what turns a folder into "5 phone bills and 3 invoices" rather than
 * a flat list. Groups come back in first-seen order. */
export function groupDocuments(docs: ReportDoc[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>()
  for (const doc of docs) {
    const key = doc.shapeId ?? `label:${normalizeKey(`${doc.docType}|${doc.entity}`)}`
    const group = groups.get(key) ?? { key, docType: doc.docType, entity: doc.entity, documentIds: [], periods: [] }
    group.documentIds.push(doc.id)
    if (doc.period.trim()) group.periods.push(doc.period.trim())
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** True for a "YYYY-MM" string; also the shape the gap finder emits. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

function monthIndex(period: string): number | null {
  const match = period.match(MONTH_PATTERN)
  return match ? Number(match[1]) * 12 + (Number(match[2]) - 1) : null
}

function indexToMonth(index: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

/** Finds the months missing from a supposedly-monthly series. Only fires with at least three valid
 * YYYY-MM periods (below that there is no cadence to infer), and enumerates every month between the
 * earliest and latest that is not present. Year-wrap aware, since months are compared as absolute
 * indices. Returns the gaps in chronological order. */
export function findPeriodGaps(periods: string[]): string[] {
  const indices = [...new Set(periods.map(monthIndex).filter((index): index is number => index !== null))].sort((a, b) => a - b)
  if (indices.length < 3) return []
  const present = new Set(indices)
  const gaps: string[] = []
  for (let index = indices[0] + 1; index < indices[indices.length - 1]; index++) {
    if (!present.has(index)) gaps.push(indexToMonth(index))
  }
  return gaps
}

/** Surfaces per-document problems extraction already recorded — required fields it could not read,
 * fields two passes disagreed on, and outright failures — as plain "{filename}: {field} …" lines,
 * so "the vendor Y invoice has no total" falls out without any domain knowledge here. */
export function collectIssues(docs: ReportDoc[]): Issue[] {
  const issues: Issue[] = []
  for (const doc of docs) {
    if (doc.status === "failed") { issues.push({ documentId: doc.id, filename: doc.filename, message: `${doc.filename}: extraction failed` }); continue }
    for (const field of doc.confidence?.missingRequiredFields ?? []) issues.push({ documentId: doc.id, filename: doc.filename, message: `${doc.filename}: ${field} missing`, fieldKey: field })
    for (const field of doc.confidence?.conflictingFields ?? []) issues.push({ documentId: doc.id, filename: doc.filename, message: `${doc.filename}: ${field} has conflicting reads`, fieldKey: field })
  }
  return issues
}
