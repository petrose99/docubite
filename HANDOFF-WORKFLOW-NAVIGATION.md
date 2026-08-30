# Handoff — Workflow navigation consolidation: upload off the sheet, Home/Files split, extract-panel polish

**Branch:** `claude/workflow-navigation-consolidation-3dc168`
**Date:** 2026-08-30
**Status:** Code-complete and verified — `npx tsc --noEmit` clean, `npx eslint` clean on every changed file (pre-existing warnings only, none introduced), `npx vitest run` 1121/1121 pass. Also verified **live in the browser** this session (the local dev DB was reachable, unlike some prior sessions) — see Verification below.

Started from a request to make the app's post-login navigation less confusing (Home and Files were duplicating the file list, and the spreadsheet nagged you to upload the moment you opened it). Went through several rounds of user correction mid-session, so the final shape is not the first draft — see "What changed direction" below if picking this up cold.

## What was built

1. **Upload/extraction removed from the spreadsheet entirely.** `components/sheet/sheet-view.tsx` and `.../files/[fileId]/sheet/page.tsx` lost the auto-open-on-empty-sheet effect, the toolbar "Extract Data" button, the `?extract=1` deep link, and every prop that only existed to feed the panel (`template`, `templatesBySheetId`, `usage`, `sheetCount`). The sheet is now a pure grid — it still resumes live polling (`useExtractionProgress`) for documents already in flight when the page loads, and `ensureFileWorkbook` still reconciles everything server-side on every load, so nothing needs the sheet open to finish.

2. **`components/extract/extract-overlay.tsx`** (new) mounts the untouched `ExtractPanel` outside the sheet, owning its own status-polling instance. Two call sites: the Files toolbar's "Upload" button (`files-browser.tsx`) and the file hub's "Upload documents" button (`components/files/file-hub-upload-button.tsx`, new — used by `files/[fileId]/page.tsx` for adding more documents to a file that already exists).

3. **Home and Files ended up as two separate destinations again** (see "What changed direction"). Final state:
   - `app/(app)/workspaces/[workspaceId]/page.tsx` (Home) — header, a "Files" nav card linking to `/files`, the review-queue callout, and the analytics section (module-gated). No quick actions, no file list.
   - `app/(app)/workspaces/[workspaceId]/files/page.tsx` (Files) — the full file/folder browser, restored as its own route (it briefly redirected to the merged Home during the mid-session merge attempt; that redirect is gone).
   - `components/shell/sidebar.tsx` — Home, Files, module nav items, then a single collapsed "Settings" entry. The ~10 individual settings links that used to sit flat in the sidebar now render as tabs across the top of settings pages via `components/shell/settings-nav.tsx` (new), wired in from `(chrome)/layout.tsx`.

4. **Files toolbar has "New folder" + "Upload" only** — "New file" was removed as redundant with Upload (which already creates the file and opens the panel; closing the panel without uploading anything leaves the same empty untitled sheet "New file" used to produce directly).

5. **Extract panel polish** (`components/extract/extract-panel.tsx`, `components/extract/column-chips.tsx`):
   - Every user-facing "column" → "field" (headings, placeholders, toasts, button labels).
   - OneDrive tab removed from the upload-source tabs (Upload / Google Drive / Email remain, all but Upload still "Soon").
   - The editable sheet-name input ("Sheet 1") removed from the header.
   - **Progressive disclosure**: Fields, Extra instructions, and Page range are hidden until there's actually a file to configure them for.

6. **Auto-naming.** A file created by "Upload" starts life named "untitled" (no naming step ever existed). `deriveFileName()` in `extract-panel.tsx` renames it the instant the first document is staged — the top-level folder name for a folder upload, or the filename minus extension otherwise — via `renameFileAction`, gated on the file's current name still literally being "untitled" (threaded through as a `fileName` prop on `ExtractOverlay`/`ExtractPanel`, so a file reopened to add more documents is never renamed out from under you).

7. **Two real bugs found while testing the ZIP path, both fixed:**
   - *Fields catch-22*: a ZIP or camera capture processes immediately on picking, with no staged preview first — so on a brand-new file there was never a document to auto-suggest fields from, and since Fields was now hidden until a file existed (item 5), a failed "Add at least one field first" save had no visible way to recover. Fixed: that failure now sets `setupRevealed`, which forces the Fields section open so the user can add one by hand and retry.
   - *Unwanted navigation*: `ensureSheetSaved()` had `router.replace(sheetBase?template=...)` on first successful save — harmless when the panel only ever lived on the sheet page (a same-page query-param update), but now that it's an overlay on Files/Home/the file hub, that line force-navigated the whole page away to the sheet on the very first successful upload. Removed (dead code now — the panel is never mounted on the sheet page anymore).

8. **Folder icon** in the Files list (`components/files/files-browser.tsx`) changed from a pale `text-stone-400` outline to a solid `fill-amber-400 text-amber-500` — previously it read as barely-there next to the green file/sheet icon.

9. New test in `models/spreadsheets.test.ts` covering `ensureFileWorkbook`'s first-ever-load reconcile path — a document extracted while its file's sheet was never opened must still seed correctly. This scenario became load-bearing once uploads stopped requiring the sheet to be open (item 1).

## What changed direction mid-session (read this before assuming the plan doc is current)

The original plan (still at `C:\Users\ADMIN\.claude\plans\lets-analysevthe-workflow-i-snazzy-platypus.md` if it still exists on this machine) called for **merging** Home and Files into one page with the file browser embedded in Home. That was built, then explicitly reverted: *"there should still be a tab for files remove it from home, but there should be a navigation to it in home"* — Files came back as its own route/sidebar item, Home lost the embedded file browser in favor of a "Files" nav card. Shortly after, *"remove the new sheet and upload documents on home"* removed Home's quick-action buttons too, so Home ended up closer to a plain landing page than either the original plan or the first revert. `components/home/quick-actions.tsx` was created, deleted, recreated, and deleted again over the course of this — it does not exist in the final state.

If continuing this work, trust the current file contents over any earlier plan artifact.

## Verification

- `npx tsc --noEmit`, `npx eslint <changed files>`, `npx vitest run` (1121 tests) all clean after every batch of edits.
- **Live in-browser**, logged in as the seeded demo admin (`admin@docubite.local` / `admin-docubite-2026` — see `prisma/seed.ts`, these are synthetic dev-only accounts):
  - Sidebar/Home/Files navigation matches the final design above.
  - Upload from both Home's Files card → Files page, and from the file hub, opens the overlay in place with no navigation.
  - Folder upload: dropped 3 files with folder-relative paths → staged correctly, file auto-renamed to the folder's name.
  - ZIP upload: built a real ZIP with `fflate` (the same library `lib/zip-ingestion.ts` uses server-side) rather than hand-rolled bytes after a first attempt with synthetic bytes failed to parse — confirmed end-to-end: document count 0→1, AI field suggestion ran, "Report" button appeared, no navigation away from Files.
  - A realistic finance invoice PDF (vendor, invoice #, date, bill-to, two line items, subtotal, tax, total) → AI suggested finance-appropriate fields (Vendor Name, Invoice Number, Invoice Date, Bill To, Line Items, Subtotal, Tax Amount, Total Due) and the real OCR/extraction pipeline landed **correct values** in the sheet, split one row per line item with header fields repeated (Consulting Hours row + Software License row, both showing the same vendor/invoice/date/subtotal/tax/total).
  - `lib/domains/finance.test.ts` and the rest of `lib/domains` — 14/14 pass, untouched by this work.

## Known pre-existing issues observed this session, not caused by this work (left alone)

- `[workspace-scope]` warnings on unfiltered `Document.count()`/`findMany()` etc. in the sheet page and document-processing pipeline — confirmed present in the original file before any edits.
- `FolderReport` shows "Could not build the report" for a single-document ZIP batch — not investigated, pre-existing `FolderReport` behavior.
- A `<button>`-inside-`<button>` hydration warning from `ExtractPanel`'s dropzone markup — pre-existing, not touched by this session's edits.

## Local dev notes (for whoever picks this up next)

- This worktree needed its own `.env` copied from the main checkout (`.env` is gitignored, per-checkout) before the dev server would start — Supabase env vars are required even for local auth.
- `.claude/launch.json` gained `"autoPort": false` — this app's `BASE_URL`/Supabase auth config defaults to `localhost:7331`, so the dev server can't silently move to a different port.
- The local dev DB (Docker pgvector on 55432) was up and usable this session, unlike some earlier sessions blocked by a PGlite/pgcrypto issue — worth checking `docker ps` before assuming it's down.
- Turbopack's dev cache needed a full server restart (not just Fast Refresh) at one point after a large batch of file moves/deletions produced spurious 404s on a route that definitely existed — if you see that, restart before debugging further.

## Files changed

- `components/sheet/sheet-view.tsx`, `.../files/[fileId]/sheet/page.tsx` — upload/extraction removed
- `components/extract/extract-panel.tsx`, `components/extract/column-chips.tsx` — field terminology, OneDrive removal, progressive disclosure, auto-naming, the two bug fixes
- `components/extract/extract-overlay.tsx` (new) — panel mount point off the sheet
- `components/files/files-browser.tsx` — Upload wired to the overlay, "New file" removed, folder icon color
- `components/files/file-hub-upload-button.tsx` (new) — file hub's upload entry point
- `app/(app)/workspaces/[workspaceId]/files/[fileId]/page.tsx` — file hub wiring for the upload button
- `app/(app)/workspaces/[workspaceId]/page.tsx` (Home), `.../files/page.tsx` (Files) — final split-apart shape
- `components/shell/sidebar.tsx`, `components/shell/settings-nav.tsx` (new), `app/(app)/workspaces/[workspaceId]/(chrome)/layout.tsx` — sidebar collapse + settings tabs
- `app/(app)/workspaces/[workspaceId]/layout.tsx` — dropped the now-unused `integrationsEnabled` prop passed to `Sidebar`
- `models/spreadsheets.test.ts` — new reconcile test
- `.claude/launch.json` — `autoPort: false`

## Next up / not done

- No changes were made to the `[workspace-scope]` unfiltered-query warnings, the single-document `FolderReport` gap, or the pre-existing hydration warning — all noted above but out of scope for this session.
- Nothing deployed; this is local-branch work only until pushed/merged.
