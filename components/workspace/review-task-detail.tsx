"use client"

import { assignReviewTaskAction, updateReviewTaskStatusAction } from "@/app/(app)/workspaces/[workspaceId]/review-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function ReviewTaskDetail({ workspaceId, taskId, status, assigneeId, members }: {
  workspaceId: string
  taskId: string
  status: string
  assigneeId: string | null
  members: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const setStatus = async (next: string) => {
    setPending(true)
    try {
      const result = await updateReviewTaskStatusAction(workspaceId, taskId, next)
      if (!result.success) { toast.error(result.error || "Could not update status"); return }
      toast.success(`Marked ${next.replace("_", " ")}`)
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const setAssignee = async (value: string) => {
    setPending(true)
    try {
      const result = await assignReviewTaskAction(workspaceId, taskId, value || null)
      if (!result.success) { toast.error(result.error || "Could not assign"); return }
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <div className="space-y-4 rounded border p-4">
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Assignee</label>
      <select className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" defaultValue={assigneeId ?? ""} disabled={pending} onChange={(event) => void setAssignee(event.target.value)}>
        <option value="">Unassigned</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
    </div>
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Status</label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {["open", "in_review", "approved", "rejected"].map((option) => (
          <button key={option} type="button" disabled={pending || status === option}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold capitalize transition-colors ${status === option ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "hover:bg-stone-50"}`}
            onClick={() => void setStatus(option)}>
            {option.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  </div>
}
