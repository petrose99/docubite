"use client"

import { createFileAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { FilePlus2, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/** Home's two entry points into the sheet, reusing files-browser.tsx's "no dialog, name it
 * later" newFile pattern — the file is created and navigated to immediately. */
export function QuickActions({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [creating, setCreating] = useState<"sheet" | "upload" | null>(null)

  const newFile = async (openExtract: boolean) => {
    setCreating(openExtract ? "upload" : "sheet")
    try {
      const result = await createFileAction(workspaceId, null)
      if (!result.success || !result.data) { toast.error(result.error || "Could not create the file"); return }
      router.push(`/workspaces/${workspaceId}/files/${result.data.fileId}/sheet${openExtract ? "?extract=1" : ""}`)
    } catch {
      toast.error("Could not reach the server — no file was created")
    } finally { setCreating(null) }
  }

  return <div className="flex flex-wrap gap-3">
    <button type="button" disabled={!!creating} onClick={() => void newFile(false)}
      className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
      <FilePlus2 className="h-4 w-4" />{creating === "sheet" ? "Creating…" : "New sheet"}
    </button>
    <button type="button" disabled={!!creating} onClick={() => void newFile(true)}
      className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50">
      <Upload className="h-4 w-4" />{creating === "upload" ? "Creating…" : "Upload documents"}
    </button>
  </div>
}
