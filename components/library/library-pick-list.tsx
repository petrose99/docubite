"use client"

import { createSheetFromDocumentsAction, splitDocumentsIntoSheetsAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ChevronRight, FileText, Layers, Table2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

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
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [splitMode, setSplitMode] = useState(false)
  const [splitNames, setSplitNames] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSplitMode(false)
  }

  const toggleAll = () => {
    if (selected.size === documents.length) setSelected(new Set())
    else setSelected(new Set(documents.map((d) => d.id)))
    setSplitMode(false)
  }

  const handleCombine = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Name is required")
      inputRef.current?.focus()
      return
    }
    startCreate(async () => {
      const result = await createSheetFromDocumentsAction(workspaceId, [...selected], trimmed)
      if (result.success && result.data) {
        router.push(`/workspaces/${workspaceId}/files/${result.data.fileId}/sheet`)
      } else {
        setError(result.error ?? "Something went wrong")
      }
    })
  }

  // Build groups from selected documents
  const groups: Array<{ templateId: string; templateName: string; count: number }> = []
  const seenGroups = new Map<string, number>()
  for (const doc of documents) {
    if (!selected.has(doc.id)) continue
    const key = doc.templateName ?? "Other"
    if (seenGroups.has(key)) {
      groups[seenGroups.get(key)!].count++
    } else {
      seenGroups.set(key, groups.length)
      groups.push({ templateId: key, templateName: key, count: 1 })
    }
  }
  const distinctTypes = groups.length

  const enterSplitMode = () => {
    const defaults: Record<string, string> = {}
    for (const g of groups) defaults[g.templateId] = g.templateName
    setSplitNames(defaults)
    setSplitMode(true)
    setError("")
  }

  const handleSplit = () => {
    for (const g of groups) {
      if (!splitNames[g.templateId]?.trim()) {
        setError("Please name every sheet")
        return
      }
    }
    startCreate(async () => {
      // Map templateName keys to actual templateId keys for the action
      // The action groups by templateId, but we grouped by templateName for display
      // We need to map the doc templateIds to names
      const docsByTemplateName = new Map<string, string[]>()
      for (const doc of documents) {
        if (!selected.has(doc.id)) continue
        const key = doc.templateName ?? "Other"
        const arr = docsByTemplateName.get(key) ?? []
        arr.push(doc.id)
        docsByTemplateName.set(key, arr)
      }

      // Create each sheet individually using the combine action with the right docs
      const fileIds: string[] = []
      for (const g of groups) {
        const ids = docsByTemplateName.get(g.templateId) ?? []
        const sheetName = splitNames[g.templateId]!.trim()
        const result = await createSheetFromDocumentsAction(workspaceId, ids, sheetName)
        if (result.success && result.data) {
          fileIds.push(result.data.fileId)
        } else {
          setError(result.error ?? "Something went wrong")
          return
        }
      }
      if (fileIds.length === 1) {
        router.push(`/workspaces/${workspaceId}/files/${fileIds[0]}/sheet`)
      } else {
        router.push(`/workspaces/${workspaceId}/files`)
      }
    })
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Table2 className="h-4 w-4 text-emerald-700" />
            <span className="text-sm font-medium text-emerald-800">
              {selected.size} document{selected.size === 1 ? "" : "s"} selected
              {distinctTypes > 1 && <span className="text-emerald-600"> · {distinctTypes} types</span>}
            </span>
          </div>

          {!splitMode ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError("") }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCombine() } }}
                  placeholder="Sheet name — e.g. Q3 Invoices"
                  className="flex-1 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={handleCombine}
                  disabled={creating}
                  className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  title="Combine all selected documents into one sheet"
                >
                  {creating ? "Creating..." : "One sheet"}
                </button>
              </div>

              {distinctTypes > 1 && (
                <button
                  onClick={enterSplitMode}
                  disabled={creating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                >
                  <Layers className="h-4 w-4" />
                  Split into {distinctTypes} sheets by type
                </button>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                {groups.map((g) => (
                  <div key={g.templateId} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-right text-xs text-emerald-600">{g.count} doc{g.count === 1 ? "" : "s"}</span>
                    <input
                      type="text"
                      value={splitNames[g.templateId] ?? ""}
                      onChange={(e) => { setSplitNames((prev) => ({ ...prev, [g.templateId]: e.target.value })); setError("") }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSplit() } }}
                      className="flex-1 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSplit}
                  disabled={creating}
                  className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {creating ? "Creating..." : `Create ${distinctTypes} sheets`}
                </button>
                <button
                  onClick={() => setSplitMode(false)}
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
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
