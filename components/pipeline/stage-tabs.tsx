import { STAGE_LABELS, PIPELINE_STAGES, type PipelineStage } from "@/lib/documents/stages"
import { Archive, CheckCircle2, ClipboardCheck, Inbox as InboxIcon, SearchCheck } from "lucide-react"
import Link from "next/link"

const STAGE_ICONS: Record<PipelineStage, typeof InboxIcon> = {
  inbox: InboxIcon,
  to_review: SearchCheck,
  ready: CheckCircle2,
  approvals: ClipboardCheck,
  archive: Archive,
}

/** The pipeline's five tabs, with an icon and a count badge each. Plain links (?stage=) rather
 * than a client router — this list is a server component's data, so switching tabs is a normal
 * navigation. No generic Tabs primitive exists in components/ui yet (checked); this is
 * hand-rolled the same way components/shell/settings-nav.tsx is. */
export function StageTabs({ workspaceId, active, counts }: { workspaceId: string; active: PipelineStage; counts: Record<PipelineStage, number> }) {
  return <nav className="flex flex-wrap gap-1 border-b px-6" aria-label="Pipeline stage">
    {PIPELINE_STAGES.map((stage) => {
      const isActive = stage === active
      const Icon = STAGE_ICONS[stage]
      return <Link key={stage} href={`/workspaces/${workspaceId}/pipeline?stage=${stage}`}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}>
        <Icon className="h-4 w-4 shrink-0" />
        {STAGE_LABELS[stage]}
        <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{counts[stage]}</span>
      </Link>
    })}
  </nav>
}
