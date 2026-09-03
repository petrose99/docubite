"use server"

import config from "@/lib/config"
import { getCurrentUser } from "@/lib/auth"
import { requireWorkspaceRole } from "@/models/workspaces"
import { getWorkspaceIntegrationConnection } from "@/models/integrations"
import { getValidAccessToken } from "@/lib/integration-token-refresh"
import { fetchReportTable } from "@/lib/integrations/bigcapital/client"
import { IntegrationAuthError } from "@/lib/integrations/errors"
import { BIGCAPITAL_REPORTS, isBigcapitalReportType, reportTableToSheet } from "@/lib/integrations/bigcapital/report-mapper"
import { ImportLimitError, sheetsToSnapshot } from "@/lib/sheet-import"
import { createFile } from "@/models/files"
import { saveWorkbook } from "@/models/spreadsheets"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function createSheetFromAccountingReportAction(
  workspaceId: string,
  input: { reportType: string; fromDate?: string; toDate?: string; name?: string },
): Promise<{ fileId: string } | { error: string }> {
  if (!config.integrations.bigcapital.enabled) return { error: "Accounting integration is not enabled" }

  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  if (!isBigcapitalReportType(input.reportType)) return { error: "Unknown report type" }
  if (input.fromDate && !DATE_RE.test(input.fromDate)) return { error: "Invalid from date" }
  if (input.toDate && !DATE_RE.test(input.toDate)) return { error: "Invalid to date" }

  const report = BIGCAPITAL_REPORTS.find((r) => r.type === input.reportType)!

  const connection = await getWorkspaceIntegrationConnection(workspaceId, "bigcapital")
  if (!connection || connection.status !== "active" || !connection.externalTenantId) {
    return { error: "No active accounting connection" }
  }

  let apiKey: string
  try {
    apiKey = await getValidAccessToken(connection.id)
  } catch (err) {
    if (err instanceof IntegrationAuthError) return { error: "Accounting connection needs attention — please reconnect" }
    throw err
  }

  let table
  try {
    table = await fetchReportTable(apiKey, connection.externalTenantId, report.path, {
      fromDate: report.supportsDateRange ? input.fromDate : undefined,
      toDate: report.supportsDateRange ? input.toDate : undefined,
    })
  } catch (err) {
    if (err instanceof IntegrationAuthError) return { error: "Accounting connection needs attention — please reconnect" }
    return { error: "Could not fetch report from accounting system" }
  }

  const today = new Date().toISOString().slice(0, 10)
  const sheetName = input.name?.trim() || `${report.label} — ${input.toDate || today}`
  const sheet = reportTableToSheet(sheetName, table)

  try {
    const created = await createFile({ workspaceId, userId: user.id, name: sheetName, folderId: null, templates: [], kind: "sheet" })
    const snapshot = sheetsToSnapshot(created.id, [sheet])
    await saveWorkbook({ workspaceId, fileId: created.id, rev: 0, snapshot })
    return { fileId: created.id }
  } catch (err) {
    if (err instanceof ImportLimitError) return { error: err.message }
    throw err
  }
}
