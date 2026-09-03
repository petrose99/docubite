"use client"

import { createSheetFromAccountingReportAction } from "@/app/(app)/workspaces/[workspaceId]/files/accounting-report-actions"
import { BIGCAPITAL_REPORTS } from "@/lib/integrations/bigcapital/report-mapper"
import { Landmark, Loader2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"

export function FromAccountingCard({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)

  return <>
    <button
      onClick={() => setOpen(true)}
      className="group flex items-center gap-3 rounded-xl border border-[#e6ebf1] bg-white px-4 py-3 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md sm:flex-col sm:items-start sm:gap-0 sm:p-5"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 sm:mb-3 sm:h-10 sm:w-10">
        <Landmark className="h-[17px] w-[17px] sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 group-hover:text-emerald-800">From Accounting</h3>
        <p className="hidden text-xs text-slate-500 sm:mt-1 sm:block">Pull a live report from your connected accounting system.</p>
      </div>
    </button>
    {open && <AccountingReportDialog workspaceId={workspaceId} onClose={() => setOpen(false)} />}
  </>
}

function AccountingReportDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter()
  const [reportType, setReportType] = useState(BIGCAPITAL_REPORTS[0].type as string)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selectedReport = BIGCAPITAL_REPORTS.find((r) => r.type === reportType)
  const showDates = selectedReport?.supportsDateRange ?? false

  const submit = useCallback(() => {
    startTransition(async () => {
      setError(null)
      const result = await createSheetFromAccountingReportAction(workspaceId, {
        reportType,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        name: name.trim() || undefined,
      })
      if ("error" in result) { setError(result.error); return }
      router.push(`/workspaces/${workspaceId}/files/${result.fileId}/sheet`)
    })
  }, [workspaceId, reportType, fromDate, toDate, name, router])

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl border border-[#e6ebf1] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">From Accounting</h2>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Report</label>
          <select
            value={reportType}
            onChange={(e) => { setReportType(e.target.value); setError(null) }}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          >
            {BIGCAPITAL_REPORTS.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
          </select>
        </div>

        {showDates && <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
        </div>}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Sheet name <span className="font-normal text-slate-400">(optional)</span></label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${selectedReport?.label ?? "Report"} — ${new Date().toISOString().slice(0, 10)}`}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
        <button onClick={submit} disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
          Create sheet
        </button>
      </div>
    </div>
  </div>
}
