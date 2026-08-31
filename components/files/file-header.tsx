"use client"

import { renameFileAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ShareDialog } from "@/components/files/share-dialog"
import { ArrowLeft, Globe, Share2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

/** The bar across the top of a file: back to Files, the inline-editable filename, and Share.
 * The name input borrows the borderless-until-hover treatment the Extract panel already uses
 * for its sheet name, so the field reads as a label until you reach for it.
 *
 * `status` is the spreadsheet's save state, which sits beside the filename the way every other
 * spreadsheet puts it — the grid below owns the rest of the window and has nowhere to say it. */
export function FileHeader({ workspaceId, fileId, name, linkAccess, status, backHref, backLabel }: {
  workspaceId: string; fileId: string; name: string; linkAccess: string; status?: ReactNode
  /** Defaults to the Files list — the sheet's file bar overrides this to the file hub instead,
   * so "← Back" from the grid returns to the hub rather than skipping over it. */
  backHref?: string; backLabel?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(name)
  const [saved, setSaved] = useState(name)
  const [sharing, setSharing] = useState(false)

  // The server is the source of truth after a rename elsewhere (the Files list, another tab).
  const [syncedName, setSyncedName] = useState(name)
  if (syncedName !== name) {
    setSyncedName(name)
    setValue(name)
    setSaved(name)
  }

  const commit = async () => {
    const next = value.trim()
    if (!next || next === saved) { setValue(saved); return }
    const result = await renameFileAction(workspaceId, fileId, next).catch(() => null)
    if (!result?.success || !result.data) {
      setValue(saved)
      toast.error(result?.error || "Could not rename the file")
      return
    }
    setValue(result.data.name)
    setSaved(result.data.name)
    router.refresh()
  }

  return <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
    <Link href={backHref ?? `/workspaces/${workspaceId}/files`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
      <ArrowLeft className="h-4 w-4" />{backLabel ?? "Files"}
    </Link>
    <input
      aria-label="File name"
      className="min-w-0 max-w-xs flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === "Escape") { setValue(saved); event.currentTarget.blur() }
      }} />
    {linkAccess !== "none" && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"><Globe className="h-3 w-3" />Shared</span>}
    {status}
    <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setSharing(true)}>
      <Share2 className="h-3.5 w-3.5" />Share
    </button>
    <ShareDialog workspaceId={workspaceId} fileId={fileId} fileName={saved} open={sharing} onClose={() => { setSharing(false); router.refresh() }} />
  </div>
}
