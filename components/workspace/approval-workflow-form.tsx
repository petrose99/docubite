"use client"

import { createApprovalWorkflowAction } from "@/app/(app)/workspaces/[workspaceId]/approval-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

type StageRow = { key: number; name: string; requireOwner: boolean }

let nextKey = 0
const emptyStage = (): StageRow => ({ key: nextKey++, name: "", requireOwner: false })

/** Stage rows are plain component state, not uncontrolled `<input defaultValue>`s — the form
 * submits by array position (`stageName_0`, `stageName_1`, ...), so removing a row has to
 * reindex everything after it, which only a controlled array can do cleanly. */
export function ApprovalWorkflowForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [stages, setStages] = useState<StageRow[]>([emptyStage(), emptyStage()])

  const updateStage = (index: number, patch: Partial<StageRow>) => setStages((previous) => previous.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)))
  const removeStage = (index: number) => setStages((previous) => previous.filter((_, i) => i !== index))
  const addStage = () => setStages((previous) => [...previous, emptyStage()])

  const submit = async (formData: FormData) => {
    setPending(true)
    try {
      formData.set("stageCount", String(stages.length))
      stages.forEach((stage, index) => {
        formData.set(`stageName_${index}`, stage.name)
        if (stage.requireOwner) formData.set(`stageRequireOwner_${index}`, "on")
      })
      const result = await createApprovalWorkflowAction(workspaceId, formData)
      if (!result.success) { toast.error(result.error || "Could not create the workflow"); return }
      toast.success("Workflow created")
      setStages([emptyStage(), emptyStage()])
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <form action={submit} className="space-y-3 rounded border p-4">
    <div>
      <label className="block text-xs font-medium text-stone-500">Workflow name</label>
      <input name="name" required className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="e.g. Two-step finance approval" />
    </div>
    <div>
      <label className="block text-xs font-medium text-stone-500">Stages, in order</label>
      <div className="mt-1.5 space-y-2">
        {stages.map((stage, index) => (
          <div key={stage.key} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-stone-400">{index + 1}.</span>
            <input value={stage.name} onChange={(event) => updateStage(index, { name: event.target.value })} className="flex-1 rounded-md border px-2.5 py-1.5 text-sm" placeholder="e.g. Bookkeeper check" />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-stone-600">
              <input type="checkbox" checked={stage.requireOwner} onChange={(event) => updateStage(index, { requireOwner: event.target.checked })} /> Owner only
            </label>
            <button type="button" disabled={stages.length <= 1} onClick={() => removeStage(index)} className="shrink-0 rounded-md border px-2 py-1 text-xs text-stone-500 hover:bg-stone-50 disabled:opacity-40">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addStage} className="mt-2 rounded-md border px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50">+ Add stage</button>
    </div>
    <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Create workflow</button>
  </form>
}
