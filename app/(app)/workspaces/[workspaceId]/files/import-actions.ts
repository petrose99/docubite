"use server"

import { getCurrentUser } from "@/lib/auth"
import { ImportLimitError, parseCsvToSheet, parseXlsxToSheets, sheetsToSnapshot } from "@/lib/sheet-import"
import { addSheetToSnapshot } from "@/lib/sheet-seed"
import { createFile } from "@/models/files"
import { getWorkbook, saveWorkbook } from "@/models/spreadsheets"
import { requireWorkspaceRole } from "@/models/workspaces"

export async function importSpreadsheetAction(workspaceId: string, folderId: string | null, formData: FormData): Promise<{ fileId: string } | { error: string }> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const file = formData.get("file") as File | null
  if (!file) return { error: "No file selected" }

  const arrayBuffer = await file.arrayBuffer()
  const name = file.name.replace(/\.(xlsx|csv)$/i, "") || "Imported sheet"
  const ext = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"

  try {
    const sheets = ext === "csv"
      ? [parseCsvToSheet(Buffer.from(arrayBuffer).toString("utf-8"), name)]
      : await parseXlsxToSheets(arrayBuffer)

    if (sheets.length === 0) return { error: "No worksheets found in the file" }

    const created = await createFile({ workspaceId, userId: user.id, name, folderId, templates: [], kind: "sheet" })
    const snapshot = sheetsToSnapshot(created.id, sheets)
    await saveWorkbook({ workspaceId, fileId: created.id, rev: 0, snapshot })
    return { fileId: created.id }
  } catch (err) {
    if (err instanceof ImportLimitError) return { error: err.message }
    throw err
  }
}

export async function importSheetTabAction(workspaceId: string, fileId: string, formData: FormData): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const file = formData.get("file") as File | null
  if (!file) return { error: "No file selected" }

  const arrayBuffer = await file.arrayBuffer()
  const tabName = file.name.replace(/\.(xlsx|csv)$/i, "") || "Imported"
  const ext = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"

  try {
    const sheets = ext === "csv"
      ? [parseCsvToSheet(Buffer.from(arrayBuffer).toString("utf-8"), tabName)]
      : await parseXlsxToSheets(arrayBuffer)

    if (sheets.length === 0) return { error: "No worksheets found in the file" }

    const wb = await getWorkbook(workspaceId, fileId)
    if (!wb) return { error: "Workbook not found" }

    let { snapshot } = wb
    for (const sheet of sheets) {
      const tabSnapshot = sheetsToSnapshot("temp", [sheet])
      const tabSheets = (tabSnapshot.sheets ?? {}) as Record<string, unknown>
      const tabOrder = (tabSnapshot.sheetOrder ?? []) as string[]
      const firstId = tabOrder[0]
      if (!firstId) continue
      const built = tabSheets[firstId] as { id: string; name: string; cellData: Record<number, Record<number, unknown>>; rowCount: number; columnCount: number }
      snapshot = addSheetToSnapshot(snapshot, {
        sheetId: built.id,
        name: sheet.name,
        columns: [],
        rows: [],
      })
      const snapshotSheets = (snapshot.sheets ?? {}) as Record<string, Record<string, unknown>>
      if (snapshotSheets[built.id]) {
        snapshotSheets[built.id] = { ...snapshotSheets[built.id], cellData: built.cellData, rowCount: built.rowCount, columnCount: built.columnCount }
      }
    }

    await saveWorkbook({ workspaceId, fileId, rev: wb.rev, snapshot })
    return {}
  } catch (err) {
    if (err instanceof ImportLimitError) return { error: err.message }
    throw err
  }
}
