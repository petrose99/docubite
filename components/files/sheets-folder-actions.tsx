"use client"

import { createFolderAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { FolderPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

export function SheetsFolderActions({ workspaceId, parentId }: { workspaceId: string; parentId: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [creating, startCreate] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) { setError("Name is required"); inputRef.current?.focus(); return }
    startCreate(async () => {
      const result = await createFolderAction(workspaceId, parentId, trimmed)
      if (result.success) {
        setOpen(false); setName(""); setError("")
        router.refresh()
      } else {
        setError(result.error ?? "Something went wrong")
      }
    })
  }

  if (open) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError("") }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleCreate() }
            if (e.key === "Escape") { setOpen(false); setName(""); setError("") }
          }}
          placeholder="Folder name"
          autoFocus
          className={`w-44 rounded-md border px-2.5 py-1.5 text-sm outline-none ${error ? "border-red-300" : "border-slate-200 focus:border-emerald-400"}`}
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {creating ? "..." : "Add"}
        </button>
        <button
          onClick={() => { setOpen(false); setName(""); setError("") }}
          className="rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
    >
      <FolderPlus className="h-4 w-4" />
      New folder
    </button>
  )
}
