// Deliberately NOT a "use server" module, for the same reason as models/files.ts: these helpers
// trust the fileId they are handed. Authorisation happens in the route handler
// (app/api/files/[fileId]/workbook/route.ts) and in the sheet page.
import { prisma } from "@/lib/db"
import { parseTemplateFields } from "@/lib/document-templates"
import { deriveSheet } from "@/lib/sheet-derive"
import { addSheetToSnapshot, appendRowsToSnapshot, buildWorkbookSnapshot, type SeedSheet } from "@/lib/sheet-seed"
import { Prisma } from "@/prisma/client"
import { randomUUID } from "crypto"

/** A Univer `IWorkbookData` snapshot. Kept as an opaque JSON object here: the shape is Univer's,
 * it changes with their versions, and nothing on the server needs to understand it beyond the
 * few fields lib/sheet-seed.ts writes. */
export type WorkbookSnapshot = Record<string, unknown>

export type StoredWorkbook = { rev: number; snapshot: WorkbookSnapshot; updatedAt: Date }

/** Snapshots are whole workbooks, not deltas, so a runaway one would be re-POSTed on every
 * debounce tick. 8 MB is far above any realistic extraction sheet and far below anything that
 * would hurt Postgres. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

export class StaleRevisionError extends Error {
  constructor(readonly currentRev: number) {
    super("stale_revision")
    this.name = "StaleRevisionError"
  }
}

export async function getWorkbook(fileId: string): Promise<StoredWorkbook | null> {
  const row = await prisma.spreadsheetWorkbook.findUnique({ where: { fileId }, select: { rev: true, snapshot: true, updatedAt: true } })
  return row ? { rev: row.rev, snapshot: row.snapshot as WorkbookSnapshot, updatedAt: row.updatedAt } : null
}

/** Creates the workbook if the file has none, otherwise saves over it — but only if the caller
 * loaded the revision that is still current. A second tab that saves against a stale rev is
 * rejected rather than silently overwriting the edits it never saw. */
export async function saveWorkbook(input: { workspaceId: string; fileId: string; rev: number; snapshot: WorkbookSnapshot }): Promise<StoredWorkbook> {
  const snapshot = input.snapshot as Prisma.InputJsonValue
  const existing = await prisma.spreadsheetWorkbook.findUnique({ where: { fileId: input.fileId }, select: { rev: true } })

  if (!existing) {
    const created = await prisma.spreadsheetWorkbook.create({
      data: { workspaceId: input.workspaceId, fileId: input.fileId, rev: 1, snapshot },
      select: { rev: true, snapshot: true, updatedAt: true },
    })
    return { rev: created.rev, snapshot: created.snapshot as WorkbookSnapshot, updatedAt: created.updatedAt }
  }

  // The rev guard lives in the WHERE clause rather than in a read-then-write, so two saves
  // racing on the same rev cannot both pass the check.
  const result = await prisma.spreadsheetWorkbook.updateMany({
    where: { fileId: input.fileId, rev: input.rev },
    data: { rev: { increment: 1 }, snapshot },
  })
  if (result.count === 0) throw new StaleRevisionError(existing.rev)

  const saved = await prisma.spreadsheetWorkbook.findUniqueOrThrow({ where: { fileId: input.fileId }, select: { rev: true, snapshot: true, updatedAt: true } })
  return { rev: saved.rev, snapshot: saved.snapshot as WorkbookSnapshot, updatedAt: saved.updatedAt }
}

/** Documents that carry extracted data. Anything still in the pipeline, or that failed, has
 * nothing to put in a row yet — excluding the unfinished states rather than listing the
 * finished ones means a status added later shows up instead of silently vanishing. */
const PENDING_STATUSES = ["received", "queued", "processing", "failed"]

/** Rows are appended in the order they arrived, and capped: a file with more extracted
 * documents than this has bigger problems than a truncated first render. */
const MAX_SEEDED_ROWS = 2000

/** Brings the file's spreadsheet up to date with its extractions, and returns it.
 *
 * This is what makes the grid the file rather than a view of it. Extraction writes Documents;
 * this walks the ones the sheet has never seen (`sheetAppliedAt IS NULL`), appends them under
 * whatever the user has already done in the grid, and stamps them so they are never appended
 * twice — across reloads, across tabs, and across a browser closed mid-processing.
 *
 * Best-effort by design: if it cannot reconcile (a concurrent save moved the revision), it
 * returns what is stored and tries again on the next load. Opening a file must not fail
 * because a row could not be appended. */
export async function ensureFileWorkbook(workspaceId: string, fileId: string): Promise<StoredWorkbook | null> {
  const templates = await prisma.documentTemplate.findMany({
    where: { fileId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
  })
  if (!templates.length) return getWorkbook(fileId)

  const existing = await getWorkbook(fileId)

  // Seeding a file for the first time takes every document; reconciling one takes only what
  // the sheet has not already absorbed.
  const pending = await prisma.document.findMany({
    where: { fileId, status: { notIn: PENDING_STATUSES }, ...(existing ? { sheetAppliedAt: null } : {}) },
    select: { id: true, filename: true, templateId: true, reviewedData: true, rawExtraction: true, confidence: true },
    orderBy: { receivedAt: "asc" },
    take: MAX_SEEDED_ROWS,
  })

  const seeds: SeedSheet[] = templates.map((template) => {
    const fields = template.versions[0] ? parseTemplateFields(template.versions[0].fields) : []
    const documents = pending.filter((document) => document.templateId === template.id)
    const { columns, rows } = deriveSheet(fields, documents, { multiRow: template.multiRow })
    return { sheetId: template.univerSheetId || randomUUID(), name: template.name, columns, rows }
  })

  const appliedIds = pending.map((document) => document.id)
  const stamp = async () => {
    const links = templates.map((template, index) =>
      template.univerSheetId === seeds[index].sheetId
        ? null
        : prisma.documentTemplate.update({ where: { id: template.id }, data: { univerSheetId: seeds[index].sheetId } }))
    await Promise.all(links.filter((link) => link !== null))
    if (appliedIds.length) await prisma.document.updateMany({ where: { id: { in: appliedIds } }, data: { sheetAppliedAt: new Date() } })
  }

  try {
    if (!existing) {
      const saved = await saveWorkbook({ workspaceId, fileId, rev: 0, snapshot: buildWorkbookSnapshot(fileId, seeds) })
      await stamp()
      return saved
    }

    if (!appliedIds.length) return existing

    let snapshot = existing.snapshot
    seeds.forEach((seed, index) => {
      // A worksheet created after the workbook was seeded has no tab yet; give it one, rows
      // and all, rather than dropping its documents on the floor.
      if (!templates[index].univerSheetId || !(snapshot.sheets as Record<string, unknown> | undefined)?.[seed.sheetId]) {
        snapshot = addSheetToSnapshot(snapshot, seed)
        return
      }
      snapshot = appendRowsToSnapshot(snapshot, seed.sheetId, seed.columns, seed.rows) ?? snapshot
    })

    const saved = await saveWorkbook({ workspaceId, fileId, rev: existing.rev, snapshot })
    await stamp()
    return saved
  } catch (error) {
    if (error instanceof StaleRevisionError) return getWorkbook(fileId)
    throw error
  }
}
