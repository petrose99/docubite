"use client"

import { importSpreadsheetAction } from "@/app/(app)/workspaces/[workspaceId]/files/import-actions"
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useRef, useState, useTransition } from "react"

export function ImportSheetDialog({ workspaceId, folderId, onClose }: {
  workspaceId: string
  folderId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const handleFile = useCallback((f: File | null) => {
    setError(null)
    setFile(f)
  }, [])

  const submit = useCallback(() => {
    if (!file) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append("file", file)
      const result = await importSpreadsheetAction(workspaceId, folderId, fd)
      if ("error" in result) { setError(result.error); return }
      router.push(`/workspaces/${workspaceId}/files/${result.fileId}/sheet`)
    })
  }, [file, workspaceId, folderId, router])

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl border border-[#e6ebf1] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Import spreadsheet</h2>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-4">
        <button
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500 hover:border-emerald-300 hover:text-emerald-700"
        >
          <FileSpreadsheet className="h-8 w-8 shrink-0" />
          <span>{file ? file.name : "Choose an .xlsx or .csv file"}</span>
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
        <button onClick={submit} disabled={!file || pending}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import
        </button>
      </div>
    </div>
  </div>
}
