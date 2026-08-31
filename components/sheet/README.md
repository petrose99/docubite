# Deprecated: Univer spreadsheet

As of the pipeline redesign (workspace-wide Inbox → To review → Ready → Approvals → Archive,
replacing folder-scoped navigation), this directory's Univer-backed spreadsheet is **unwired from
navigation but not deleted**. No page or button in the app links here anymore:

- `files/[fileId]/page.tsx` no longer has an "Open spreadsheet" button.
- `components/shell/sidebar.tsx` no longer special-cases the `/sheet` route.
- The pipeline's bulk export uses `models/documents.ts::documentDataForExport`, not this sheet's
  own `/export` route or `lib/sheet-export.ts`'s snapshot reader.

The route (`files/[fileId]/sheet/page.tsx`), `models/spreadsheets.ts`, `lib/sheet-*.ts`,
`lib/ai-formula.ts`, `models/ai-formulas.ts`, `app/shared/[fileId]`, and the workbook API are all
left in place and still work if reached by a direct URL (e.g. an old bookmark) — this is a
reversible cutover, not a removal.

**Follow-up (not yet scheduled):** once the pipeline has fully replaced the sheet as the
upload→review surface, delete this directory and its dependents in one pass:
`components/sheet/**`, `models/spreadsheets.ts`, `lib/sheet-*.ts`, `lib/ai-formula.ts`,
`models/ai-formulas.ts`, the sheet route, `app/shared/[fileId]`, the workbook API, and
`Document.sheetAppliedAt` (harmless to leave, but no longer meaningful once nothing writes to it).
