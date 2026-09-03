"use client"

import { createFileAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ArrowDownToLine, FileSpreadsheet, Library } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

const ICONS = {
  blank: FileSpreadsheet,
  import: ArrowDownToLine,
  extraction: Library,
} as const

export function SheetsCreateCard({ icon, title, description, workspaceId, href, badge, folderId }: {
  icon: keyof typeof ICONS
  title: string
  description: string
  workspaceId: string
  href?: string
  badge?: number
  folderId?: string | null
}) {
  const router = useRouter()
  const [creating, startCreate] = useTransition()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const Icon = ICONS[icon]

  const handleClick = () => {
    if (href) {
      router.push(href)
      return
    }
    setNaming(true)
    setError("")
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Name is required")
      inputRef.current?.focus()
      return
    }
    startCreate(async () => {
      const result = await createFileAction(workspaceId, folderId ?? null, trimmed)
      if (result.success && result.data) {
        router.push(`/workspaces/${workspaceId}/files/${result.data.fileId}/sheet`)
      } else {
        setError(result.error ?? "Something went wrong")
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleCreate() }
    if (e.key === "Escape") { setNaming(false); setName(""); setError("") }
  }

  if (naming) {
    return (
      <div className="flex flex-col items-start rounded-xl border border-emerald-200 bg-white p-5 shadow-panel">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <Icon className="h-5 w-5" />
        </div>
        <label className="mb-1 text-sm font-semibold text-slate-900">Name your sheet</label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError("") }}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Q3 Invoices"
          className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        <div className="mt-3 flex w-full gap-2">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create"}
          </button>
          <button
            onClick={() => { setNaming(false); setName(""); setError("") }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={creating}
      className="group flex flex-col items-start rounded-xl border border-[#e6ebf1] bg-white p-5 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md disabled:opacity-60"
    >
      <div className="relative mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-5 w-5" />
        {badge != null && badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-700 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold text-slate-900 group-hover:text-emerald-800">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </button>
  )
}
