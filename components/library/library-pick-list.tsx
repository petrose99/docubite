"use client"

import { createSheetFromDocumentsAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ChevronRight, FileText, Table2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

type LibraryDoc = {
  id: string
  filename: string
  supplier: string | null
  category: string | null
  total: string | null
  templateName: string | null
}

export function LibraryPickList({ workspaceId, documents, stage }: {
  workspaceId: string
  documents: LibraryDoc[]
  stage: "ready" | "archive"
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, startCreate] = useTransition()

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === documents.length) setSelected(new Set())
    else setSelected(new Set(documents.map((d) => d.id)))
  }

  const handleCreate = () => {
    startCreate(async () => {
      const result = await createSheetFromDocumentsAction(workspaceId, [...selected])
      if (result.success && result.data) {
        router.push(`/workspaces/${workspaceId}/files/${result.data.fileId}/sheet`)
      }
    })
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-3 shadow-sm backdrop-blur-sm">
          <Table2 className="h-4 w-4 text-emerald-700" />
          <span className="text-sm font-medium text-emerald-800">
            {selected.size} document{selected.size === 1 ? "" : "s"} selected
          </span>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="ml-auto rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create sheet"}
          </button>
        </div>
      )}

      <div className="divide-y rounded-xl border border-[#e6ebf1] bg-white shadow-panel">
        {documents.length > 1 && (
          <button onClick={toggleAll} className="flex w-full items-center gap-3 px-5 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected.size === documents.length}
              readOnly
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 accent-emerald-700"
            />
            {selected.size === documents.length ? "Deselect all" : "Select all"}
          </button>
        )}
        {documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => toggle(doc.id)}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={selected.has(doc.id)}
              readOnly
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 accent-emerald-700"
            />
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500">
              <FileText className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">
                {doc.supplier ?? "Unknown supplier"}
                {doc.category ? ` · ${doc.category}` : ""}
              </div>
              <div className="text-xs text-slate-400">
                {doc.filename}
                {doc.total ? ` · ${doc.total}` : ""}
                {doc.templateName ? ` · ${doc.templateName}` : ""}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              stage === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}>
              {stage === "ready" ? "Approved" : "Archived"}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>
    </>
  )
}
