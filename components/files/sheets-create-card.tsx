"use client"

import { createFileAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ArrowDownToLine, FileSpreadsheet, Library } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

const ICONS = {
  blank: FileSpreadsheet,
  import: ArrowDownToLine,
  extraction: Library,
} as const

export function SheetsCreateCard({ icon, title, description, workspaceId, href, badge }: {
  icon: keyof typeof ICONS
  title: string
  description: string
  workspaceId: string
  href?: string
  badge?: number
}) {
  const router = useRouter()
  const [creating, startCreate] = useTransition()
  const Icon = ICONS[icon]

  const handleClick = () => {
    if (href) {
      router.push(href)
      return
    }
    startCreate(async () => {
      const result = await createFileAction(workspaceId, null)
      if (result.success && result.data) {
        router.push(`/workspaces/${workspaceId}/files/${result.data.fileId}/sheet`)
      }
    })
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
