"use client"

import { createFileAction, createFolderAction, deleteFilesAction, deleteFolderAction, duplicateFileAction, moveFilesAction, renameFileAction, renameFolderAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ExtractOverlay } from "@/components/extract/extract-overlay"
import type { WorkspaceUsage } from "@/components/extract/types"
import { ShareDialog } from "@/components/files/share-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { ArrowUpDown, ChevronRight, Copy, FileText, Folder, FolderPlus, FolderUp, Globe, Loader2, MoreHorizontal, Pencil, Search, Share2, Table2, Trash2, Upload } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

export type FileRowData = {
  id: string
  name: string
  updatedAt: string
  linkAccess: string
  documentCount: number
  shareCount: number
  folderName: string | null
  workspaceId: string
  sharedAccess: string | null
  /** Set on My-Files name-match rows during a content search: which folder the file is in, and
   * whether that folder is inside the one being searched from. Absent on the shared tab. */
  folderId?: string | null
  inScope?: boolean
}
export type FolderRowData = { id: string; name: string; fileCount: number; folderCount: number }

/** One document whose *contents* matched the search, with where to open it. */
export type ContentMatchRow = {
  documentId: string
  filename: string
  fileId: string
  fileName: string
  page: number | null
  bbox: [number, number, number, number] | null
  snippet: string
  inScope: boolean
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Marks the query's words in a snippet — case-insensitive, whole-run — so the reason a document
 * matched is visible. Pure: splits on a capture group so matched runs land at odd indices. */
function highlightSnippet(snippet: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter((word) => word.length >= 2)
  if (!words.length) return snippet
  const re = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi")
  return snippet.split(re).map((segment, index) =>
    index % 2 === 1 ? <mark key={index} className="rounded-sm bg-amber-100 text-inherit">{segment}</mark> : segment,
  )
}

const relativeTime = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "minute"], [3600, "hour"], [86_400, "day"], [604_800, "week"], [2_629_800, "month"], [31_557_600, "year"]]
  let index = units.length - 1
  while (index > 0 && seconds < units[index][0]) index--
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.floor(seconds / units[index][0]), units[index][1])
}

/** "33 minutes ago" is computed from the clock, so the server's render and the client's
 * hydration land on different strings whenever a minute ticks over between them. The mismatch
 * is expected and harmless here, so it is suppressed rather than papered over with an absolute
 * date; the exact timestamp stays available in the tooltip. */
const LastUpdated = ({ iso }: { iso: string }) => <time dateTime={iso} title={new Date(iso).toISOString()} suppressHydrationWarning>{relativeTime(iso)}</time>

/** Row action menu. Closes on outside click and Escape so it never survives a navigation. */
function RowMenu({ items }: { items: Array<{ label: string; icon: typeof Pencil; destructive?: boolean; onSelect: () => void }> }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("mousedown", onPointerDown); window.removeEventListener("keydown", onKeyDown) }
  }, [open])
  return <div ref={wrapper} className="relative">
    <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={() => setOpen((value) => !value)}><MoreHorizontal className="h-4 w-4" /></button>
    {open && <div role="menu" className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-md border bg-white py-1 shadow-lg">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-100 ${item.destructive ? "text-red-600 hover:bg-red-50" : "text-stone-700"}`}
        onClick={() => { setOpen(false); item.onSelect() }}><item.icon className="h-3.5 w-3.5" />{item.label}</button>)}
    </div>}
  </div>
}

export function FilesBrowser({ workspaceId, tab, folderId, trail, search, sort, dir, folders, allFolders, files, sharedFiles, documentSearchEnabled = false, contentMatches = [], scopeFolderName = null, usage }: {
  workspaceId: string
  tab: "mine" | "shared"
  folderId: string | null
  trail: Array<{ id: string; name: string }>
  search: string
  sort: "name" | "updatedAt"
  dir: "asc" | "desc"
  folders: FolderRowData[]
  /** Every folder in the workspace, flat: move targets are not limited to the current level. */
  allFolders: Array<{ id: string; name: string }>
  files: FileRowData[]
  sharedFiles: FileRowData[]
  /** All additive and default-off, so a caller that omits them renders exactly today's Files list.
   * When on, the search box also finds documents by content, and searching inside a folder groups
   * the results into "In {folder}" and "Everywhere else". */
  documentSearchEnabled?: boolean
  contentMatches?: ContentMatchRow[]
  scopeFolderName?: string | null
  /** Fed straight into the Extract overlay's quota meter when "Upload" creates a new file. */
  usage: WorkspaceUsage
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // This list's own page (folder nav, search, sort) and a row/newly created file's own sheet both
  // hang off the same /files prefix.
  const pageBase = `/workspaces/${workspaceId}/files`
  const fileBase = pageBase
  const rows = tab === "shared" ? sharedFiles : files

  const [marked, setMarked] = useState<Set<string>>(new Set())
  const anchor = useRef<number | null>(null)
  const [searchValue, setSearchValue] = useState(search)
  const [creating, setCreating] = useState(false)
  // The file an "Upload" just created, so the Extract overlay can open in place instead of
  // navigating into the (now upload-free) sheet.
  const [uploadFileId, setUploadFileId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newFolder, setNewFolder] = useState<{ name: string } | null>(null)
  const [renaming, setRenaming] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null)
  const [sharingFile, setSharingFile] = useState<FileRowData | null>(null)
  const [confirming, setConfirming] = useState<{ kind: "files"; ids: string[] } | { kind: "folder"; id: string; name: string } | null>(null)

  // The list re-renders from the server after every mutation; marks that pointed at rows which
  // no longer exist would otherwise keep inflating the "Delete (n)" count.
  const [syncedRows, setSyncedRows] = useState(rows)
  if (syncedRows !== rows) {
    setSyncedRows(rows)
    const live = new Set(rows.map((row) => row.id))
    setMarked((previous) => new Set([...previous].filter((id) => live.has(id))))
  }

  // Same derived-state shape as syncedRows above: adopt the URL's query when it changes from
  // outside this component (back button, a link), without an effect round-trip.
  const [syncedSearch, setSyncedSearch] = useState(search)
  if (syncedSearch !== search) {
    setSyncedSearch(search)
    setSearchValue(search)
  }

  const withParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) { if (value === null || value === "") params.delete(key); else params.set(key, value) }
    const query = params.toString()
    return query ? `${pageBase}?${query}` : pageBase
  }

  // Search is URL-driven, matching how the sheet page already threads ?status= and ?q=.
  useEffect(() => {
    if (searchValue === search) return
    const timer = setTimeout(() => router.push(withParams({ q: searchValue || null })), 300)
    return () => clearTimeout(timer)
  }, [searchValue]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Same state machine as the spreadsheet grid's row gutter: a plain click toggles one row and
   * becomes the anchor, shift-click adds the range between the anchor and the clicked row. */
  const markRow = (index: number, event: React.MouseEvent | React.KeyboardEvent) => {
    const row = rows[index]
    if (!row) return
    const start = anchor.current
    if ("shiftKey" in event && event.shiftKey && start !== null && start < rows.length) {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      const [from, to] = start <= index ? [start, index] : [index, start]
      setMarked((previous) => {
        const next = new Set(previous)
        for (let cursor = from; cursor <= to; cursor++) next.add(rows[cursor].id)
        return next
      })
      return
    }
    anchor.current = index
    setMarked((previous) => {
      const next = new Set(previous)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const toggleAll = () => {
    setMarked((previous) => (previous.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))))
    anchor.current = null
  }

  /** The one way to create a file: creates it with no dialog — named "untitled", renamed inline
   * later — then opens the Extract overlay right here, which offers both a normal file picker
   * and an "upload a whole folder" option inside it. A separate "New file" button was redundant
   * with this: closing the overlay without uploading anything leaves exactly the same empty,
   * untitled sheet "New file" used to create directly. */
  const newFile = async () => {
    setCreating(true)
    try {
      const result = await createFileAction(workspaceId, folderId)
      if (!result.success || !result.data) { toast.error(result.error || "Could not create the file"); return }
      setUploadFileId(result.data.fileId)
      router.refresh()
    } catch {
      toast.error("Could not reach the server — no file was created")
    } finally { setCreating(false) }
  }

  const submitFolder = async () => {
    if (!newFolder?.name.trim()) return
    setBusy(true)
    try {
      const result = await createFolderAction(workspaceId, folderId, newFolder.name)
      if (!result.success) { toast.error(result.error || "Could not create the folder"); return }
      setNewFolder(null)
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const submitRename = async () => {
    if (!renaming?.name.trim()) return
    setBusy(true)
    try {
      const result = renaming.kind === "file"
        ? await renameFileAction(workspaceId, renaming.id, renaming.name)
        : await renameFolderAction(workspaceId, renaming.id, renaming.name)
      if (!result.success) { toast.error(result.error || "Rename failed"); return }
      setRenaming(null)
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const duplicate = async (file: FileRowData) => {
    setBusy(true)
    try {
      const result = await duplicateFileAction(workspaceId, file.id)
      if (!result.success || !result.data) { toast.error(result.error || "Could not copy the file"); return }
      toast.success(`Copied${result.data.documentsCopied ? ` with ${result.data.documentsCopied} document${result.data.documentsCopied === 1 ? "" : "s"}` : ""}`, result.data.truncated ? { description: "Only the first 500 documents were copied." } : undefined)
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const moveMarked = async (target: string | null) => {
    setBusy(true)
    try {
      const result = await moveFilesAction(workspaceId, [...marked], target)
      if (!result.success || !result.data) { toast.error(result.error || "Move failed"); return }
      toast.success(`${result.data.moved} file${result.data.moved === 1 ? "" : "s"} moved`)
      setMarked(new Set())
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const confirmDelete = async () => {
    if (!confirming) return
    setBusy(true)
    try {
      if (confirming.kind === "files") {
        const result = await deleteFilesAction(workspaceId, confirming.ids)
        if (!result.success || !result.data) { toast.error(result.error || "Delete failed"); return }
        toast.success(`${result.data.deleted} file${result.data.deleted === 1 ? "" : "s"} deleted`)
        setMarked(new Set())
      } else {
        const result = await deleteFolderAction(workspaceId, confirming.id)
        if (!result.success || !result.data) { toast.error(result.error || "Delete failed"); return }
        toast.success(`Folder deleted${result.data.deletedFiles ? ` with ${result.data.deletedFiles} file${result.data.deletedFiles === 1 ? "" : "s"}` : ""}`)
      }
      setConfirming(null)
      router.refresh()
    } catch { toast.error("Could not reach the server — nothing was deleted") } finally { setBusy(false) }
  }

  const sortLink = (field: "name" | "updatedAt") => withParams({ sort: field, dir: sort === field && dir === "asc" ? "desc" : "asc" })
  const sortArrow = (field: "name" | "updatedAt") => (sort === field ? <ArrowUpDown className={`h-3 w-3 ${dir === "asc" ? "" : "rotate-180"}`} /> : <ArrowUpDown className="h-3 w-3 opacity-25" />)

  const inputClass = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

  // Content matches accompany a real search on My Files when the feature is on; grouping is that,
  // plus a folder to scope against. `rows` is indexed for selection, so name rows are rendered from
  // it (filtered by scope) rather than from a copy, keeping shift-click ranges correct.
  const showContent = documentSearchEnabled && tab === "mine" && !!search
  const grouping = showContent && !!scopeFolderName
  const empty = !rows.length && !folders.length && !(showContent && contentMatches.length > 0)

  const groupHeader = (label: string) => (
    <tr><td colSpan={5} className="border-b bg-stone-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</td></tr>
  )

  const fileRow = (file: FileRowData, index: number) => {
    const href = tab === "shared" ? `/shared/${file.id}` : `${fileBase}/${file.id}`
    return <tr key={file.id} className={marked.has(file.id) ? "bg-emerald-50/60" : "hover:bg-stone-50"}>
      <td className="border-b px-3 py-2">
        {tab === "mine" && <input type="checkbox" aria-label={`Select ${file.name}`} className="h-4 w-4 accent-emerald-600" checked={marked.has(file.id)}
          onMouseDown={(event) => { if (event.shiftKey) event.preventDefault() }}
          onClick={(event) => { event.preventDefault(); markRow(index, event) }}
          onChange={() => {}} />}
      </td>
      <td className="border-b px-3 py-2">
        <Link href={href} className="inline-flex items-center gap-2 font-medium text-stone-800 hover:text-emerald-800">
          <Table2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="truncate" title={file.name}>{file.name}</span>
          {file.linkAccess !== "none" && <Globe className="h-3.5 w-3.5 shrink-0 text-stone-300" aria-label="Shared by link" />}
        </Link>
        {file.folderName && <span className="ml-6 text-xs text-stone-400">in {file.folderName}</span>}
      </td>
      <td className="border-b px-3 py-2 text-stone-500">
        {tab === "shared" ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{file.sharedAccess === "edit" ? "Can edit" : file.sharedAccess === "interact" ? "Can interact" : "Can view"}</span> : file.documentCount}
      </td>
      <td className="border-b px-3 py-2 text-stone-500"><LastUpdated iso={file.updatedAt} /></td>
      <td className="border-b px-3 py-2">
        {tab === "mine" && <div className="flex items-center justify-end gap-1">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50" onClick={() => setSharingFile(file)}>
            <Share2 className="h-3.5 w-3.5" />Share
          </button>
          <RowMenu items={[
            { label: "Rename", icon: Pencil, onSelect: () => setRenaming({ kind: "file", id: file.id, name: file.name }) },
            { label: "Make a copy", icon: Copy, onSelect: () => void duplicate(file) },
            { label: "Delete", icon: Trash2, destructive: true, onSelect: () => setConfirming({ kind: "files", ids: [file.id] }) },
          ]} />
        </div>}
      </td>
    </tr>
  }

  const contentRow = (match: ContentMatchRow) => {
    const params = new URLSearchParams({ doc: match.documentId })
    if (match.page != null) params.set("page", String(match.page))
    if (match.bbox) params.set("bb", match.bbox.join(","))
    return <tr key={`content-${match.documentId}`} className="hover:bg-stone-50">
      <td className="border-b px-3 py-2"></td>
      <td colSpan={4} className="border-b px-3 py-2">
        <Link href={`${fileBase}/${match.fileId}/sheet?${params.toString()}`} className="block">
          <span className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
            <span className="truncate font-medium text-stone-800" title={match.filename}>{match.filename}</span>
            {match.fileName && <span className="shrink-0 text-xs text-stone-400">in {match.fileName}</span>}
            {match.page != null && <span className="shrink-0 rounded bg-emerald-50 px-1 font-mono text-[11px] text-emerald-800">p.{match.page}</span>}
          </span>
          {match.snippet && <span className="ml-[1.375rem] mt-0.5 line-clamp-2 text-xs text-stone-500">{highlightSnippet(match.snippet, search)}</span>}
        </Link>
      </td>
    </tr>
  }

  // Name matches split by scope, keeping each row's original index in `rows` for selection.
  const indexedRows = rows.map((file, index) => ({ file, index }))
  const inScopeRows = indexedRows.filter(({ file }) => file.inScope)
  const outScopeRows = indexedRows.filter(({ file }) => !file.inScope)
  const inScopeContent = contentMatches.filter((match) => match.inScope)
  const outScopeContent = contentMatches.filter((match) => !match.inScope)
  const matchedDivider = <tr><td colSpan={5} className="border-b bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">Matched inside documents</td></tr>

  return <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
    <div className="flex flex-wrap items-center gap-2">
      {tab === "mine" && <>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50" disabled={busy} onClick={() => setNewFolder({ name: "" })}>
          <FolderPlus className="h-4 w-4" />New folder
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={creating} onClick={() => void newFile()}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload
        </button>
      </>}
      <div className="relative ml-auto w-64 max-w-full">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input className={`${inputClass} pl-8`} placeholder={documentSearchEnabled ? "Search files and documents" : "Search files"} value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
      </div>
    </div>

    {tab === "mine" && (trail.length > 0 || search) && <nav className="flex flex-wrap items-center gap-1 text-sm text-stone-500">
      <Link href={withParams({ folder: null })} className="rounded px-1.5 py-0.5 font-medium hover:bg-stone-100 hover:text-stone-800">All files</Link>
      {trail.map((folder) => <span key={folder.id} className="flex items-center gap-1">
        <ChevronRight className="h-3.5 w-3.5 text-stone-300" />
        <Link href={withParams({ folder: folder.id })} className="rounded px-1.5 py-0.5 font-medium hover:bg-stone-100 hover:text-stone-800">{folder.name}</Link>
      </span>)}
      {search && (!documentSearchEnabled || !folderId) && <span className="ml-2 text-xs text-stone-400">Searching every folder for “{search}”</span>}
    </nav>}

    {marked.size > 0 && tab === "mine" && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-stone-50 px-3 py-2 text-sm">
      <span className="font-medium text-stone-700">{marked.size} selected</span>
      {(allFolders.length > 0 || folderId) && <label className="inline-flex items-center gap-1.5 font-medium text-stone-700">
        <FolderUp className="h-3.5 w-3.5" />
        <span className="sr-only">Move selected files to</span>
        {/* Value is reset to "" after every move so the control reads as an action, not a
            setting — the rows it applied to are gone from the selection by then. */}
        <select className="rounded-md border bg-white px-2 py-1 text-sm disabled:opacity-50" disabled={busy} value="" onChange={(event) => { if (event.target.value) void moveMarked(event.target.value === "root" ? null : event.target.value) }}>
          <option value="">Move to…</option>
          {folderId && <option value="root">All files</option>}
          {allFolders.filter((folder) => folder.id !== folderId).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>}
      <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50" disabled={busy} onClick={() => setConfirming({ kind: "files", ids: [...marked] })}><Trash2 className="h-3.5 w-3.5" />Delete ({marked.size})</button>
      <button type="button" className="rounded-md px-2 py-1 font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800" onClick={() => { setMarked(new Set()); anchor.current = null }}>Clear</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
          <tr>
            <th className="w-10 border-b px-3 py-2">
              {tab === "mine" && <input type="checkbox" aria-label="Select all files" className="h-4 w-4 accent-emerald-600" checked={rows.length > 0 && marked.size === rows.length} onChange={toggleAll} />}
            </th>
            <th className="border-b px-3 py-2"><Link href={sortLink("name")} className="inline-flex items-center gap-1 hover:text-stone-800">Name {sortArrow("name")}</Link></th>
            <th className="border-b px-3 py-2">{tab === "shared" ? "Access" : "Rows"}</th>
            <th className="border-b px-3 py-2"><Link href={sortLink("updatedAt")} className="inline-flex items-center gap-1 hover:text-stone-800">Last updated {sortArrow("updatedAt")}</Link></th>
            <th className="w-28 border-b px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => <tr key={folder.id} className="hover:bg-stone-50">
            <td className="border-b px-3 py-2"></td>
            <td className="border-b px-3 py-2">
              <Link href={withParams({ folder: folder.id })} className="inline-flex items-center gap-2 font-medium text-stone-800 hover:text-emerald-800">
                <Folder className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" />{folder.name}
              </Link>
            </td>
            <td className="border-b px-3 py-2 text-stone-400">{folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}</td>
            <td className="border-b px-3 py-2 text-stone-400">—</td>
            <td className="border-b px-3 py-2">
              <div className="flex justify-end">
                <RowMenu items={[
                  { label: "Rename", icon: Pencil, onSelect: () => setRenaming({ kind: "folder", id: folder.id, name: folder.name }) },
                  { label: "Delete", icon: Trash2, destructive: true, onSelect: () => setConfirming({ kind: "folder", id: folder.id, name: folder.name }) },
                ]} />
              </div>
            </td>
          </tr>)}

          {grouping ? <>
            {(inScopeRows.length > 0 || inScopeContent.length > 0) && <>
              {groupHeader(`In ${scopeFolderName}`)}
              {inScopeRows.map(({ file, index }) => fileRow(file, index))}
              {inScopeContent.length > 0 && matchedDivider}
              {inScopeContent.map(contentRow)}
            </>}
            {(outScopeRows.length > 0 || outScopeContent.length > 0) && <>
              {groupHeader("Everywhere else")}
              {outScopeRows.map(({ file, index }) => fileRow(file, index))}
              {outScopeContent.length > 0 && matchedDivider}
              {outScopeContent.map(contentRow)}
            </>}
          </> : <>
            {rows.map((file, index) => fileRow(file, index))}
            {showContent && contentMatches.length > 0 && matchedDivider}
            {showContent && contentMatches.map(contentRow)}
          </>}

          {empty && <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-stone-400">
            {tab === "shared" ? "Nothing has been shared with you yet." : search ? `No files match “${search}”.` : "No files yet — create your first one to start extracting data."}
          </td></tr>}
        </tbody>
      </table>
    </div>

    <Dialog open={newFolder !== null} onClose={() => setNewFolder(null)} title="Create folder">
      <div className="space-y-4 px-5 py-4">
        <input autoFocus className={inputClass} placeholder="Folder name" value={newFolder?.name ?? ""} onChange={(event) => setNewFolder({ name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitFolder() } }} />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" onClick={() => setNewFolder(null)}>Cancel</button>
          <button type="button" className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy || !newFolder?.name.trim()} onClick={() => void submitFolder()}>Create</button>
        </div>
      </div>
    </Dialog>

    <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title={renaming?.kind === "folder" ? "Rename folder" : "Rename file"}>
      <div className="space-y-4 px-5 py-4">
        <input autoFocus className={inputClass} value={renaming?.name ?? ""} onChange={(event) => setRenaming((current) => (current ? { ...current, name: event.target.value } : current))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitRename() } }} />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" onClick={() => setRenaming(null)}>Cancel</button>
          <button type="button" className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy || !renaming?.name.trim()} onClick={() => void submitRename()}>Rename</button>
        </div>
      </div>
    </Dialog>

    {sharingFile && <ShareDialog workspaceId={workspaceId} fileId={sharingFile.id} fileName={sharingFile.name} open onClose={() => { setSharingFile(null); router.refresh() }} />}

    <ConfirmDialog
      open={confirming !== null}
      destructive
      busy={busy}
      title={confirming?.kind === "folder" ? `Delete "${confirming.name}"?` : `Delete ${confirming?.ids.length ?? 0} file${confirming?.ids.length === 1 ? "" : "s"}?`}
      description={confirming?.kind === "folder"
        ? "Every file inside this folder is deleted too, along with its uploaded sources and extracted rows. This cannot be undone."
        : "This removes the file's worksheets, its extracted rows, and the uploaded sources behind them. This cannot be undone."}
      confirmLabel={busy ? "Deleting…" : "Delete"}
      onConfirm={() => void confirmDelete()}
      onCancel={() => setConfirming(null)} />

    {uploadFileId && <ExtractOverlay
      workspaceId={workspaceId}
      fileId={uploadFileId}
      fileName="untitled"
      template={null}
      usage={usage}
      sheetCount={0}
      documentSearchEnabled={documentSearchEnabled}
      onClose={() => { setUploadFileId(null); router.refresh() }} />}
  </div>
}
