import type { SheetTemplate } from "@/components/extract/types"
import { FileHubUploadButton } from "@/components/files/file-hub-upload-button"
import { GettingStartedCard } from "@/components/onboarding/getting-started"
import { WelcomeTour } from "@/components/onboarding/welcome-tour"
import { SectionIntro } from "@/components/shell/section-intro"
import { LastUpdated } from "@/components/shared/relative-time"
import config from "@/lib/config"
import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields } from "@/lib/document-templates"
import { countDocumentsByStage, countDocumentsThisMonth, countToReviewByFile, flaggedFieldsFromConfidence, listWorkspaceDocuments, summarizeDocumentForReview } from "@/models/documents"
import { countReviewedUnplaced } from "@/models/document-sheet-placements"
import { ensurePipelineFile, getFileTemplates, listRecentFiles } from "@/models/files"
import { getWorkspaceUsage, requireWorkspaceRole } from "@/models/workspaces"
import { MobileUploadButtons } from "@/components/shell/mobile-upload-buttons"
import { getOnboardingStateAction } from "./onboarding-actions"
import { Archive, ArrowRight, CheckCircle2, ChevronRight, FileText, ListChecks, SearchCheck, Table2, Upload } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

/** "due_date" -> "Due date" — good enough for a reason blurb without a template-field lookup. */
function formatFieldKey(key: string): string {
  const words = key.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export default async function WorkspaceHomePage({ params }: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)

  const documentSearchEnabled = config.embeddings.enabled

  const [pipelineFile, usage, stageCounts, documentsThisMonth, recentFiles, onboardingState, unplacedCount] = await Promise.all([
    ensurePipelineFile(workspaceId, user.id),
    getWorkspaceUsage(workspaceId),
    countDocumentsByStage(workspaceId),
    countDocumentsThisMonth(workspaceId),
    listRecentFiles(workspaceId, 4),
    getOnboardingStateAction(workspaceId),
    countReviewedUnplaced(workspaceId),
  ])
  const pipelineTemplates = await getFileTemplates(workspaceId, pipelineFile.id)
  const uploadTemplates: SheetTemplate[] = pipelineTemplates.flatMap((candidate) => {
    const version = candidate.versions[0]
    if (!version) return []
    return [{ id: candidate.id, code: candidate.code, name: candidate.name, multiRow: candidate.multiRow, documentCount: 0, fields: parseTemplateFields(version.fields), prompt: version.prompt || "" }]
  })

  const [needsReview, recentFileReviewCounts] = await Promise.all([
    listWorkspaceDocuments(workspaceId, { stage: "to_review" }),
    countToReviewByFile(workspaceId, recentFiles.map((file) => file.id)),
  ])

  const stats = [
    { label: "Documents this month", value: documentsThisMonth, icon: FileText, href: null, iconClass: "bg-emerald-50 text-emerald-700", hoverClass: "" },
    { label: "In review", value: stageCounts.to_review, icon: SearchCheck, href: `/workspaces/${workspaceId}/pipeline?stage=to_review`, iconClass: "bg-indigo-50 text-indigo-600", hoverClass: "hover:border-[#c7d2fe] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_26px_rgba(79,70,229,0.10)]" },
    { label: "Ready", value: stageCounts.ready, icon: CheckCircle2, href: `/workspaces/${workspaceId}/pipeline?stage=ready`, iconClass: "bg-emerald-50 text-emerald-700", hoverClass: "hover:border-[#a7f3d0] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_26px_rgba(4,120,87,0.10)]" },
    { label: "Archived", value: stageCounts.archive, icon: Archive, href: `/workspaces/${workspaceId}/pipeline?stage=archive`, iconClass: "bg-slate-100 text-slate-500", hoverClass: "hover:border-[#cbd5e1] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_26px_rgba(15,23,42,0.07)]" },
  ]

  return <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-[18px] md:space-y-6 md:p-6">
    <WelcomeTour workspaceId={workspaceId} tourSeen={onboardingState.tourSeen} />
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#0f9d6f] md:text-xs">{greeting(new Date())}, {(user.name || user.email).split(" ")[0]}</p>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[25px] font-extrabold leading-[1.15] tracking-[-0.025em] text-slate-900 md:text-[33px] md:leading-normal">Welcome back to {membership.workspace.name}</h1>
          <SectionIntro section="dashboard" workspaceId={workspaceId} />
        </div>
        {stageCounts.to_review > 0 && <p className="mt-1.5 text-[13.5px] text-slate-500 md:text-[14.5px]">{stageCounts.to_review} document{stageCounts.to_review === 1 ? " is" : "s are"} waiting for review across your pipeline.</p>}
      </div>
      <div className="hidden md:block">
        <FileHubUploadButton
          workspaceId={workspaceId}
          fileId={pipelineFile.id}
          fileName="Pipeline"
          template={uploadTemplates[0] ?? null}
          templates={uploadTemplates}
          usage={usage}
          sheetCount={pipelineTemplates.length}
          documentSearchEnabled={documentSearchEnabled}
          primary />
      </div>
    </header>

    <MobileUploadButtons workspaceId={workspaceId} fileId={pipelineFile.id} />

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
      {stats.map((stat) => {
        const inner = <>
          <div className={`mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-[10px] sm:mb-3.5 sm:h-[38px] sm:w-[38px] sm:rounded-[11px] ${stat.iconClass}`}><stat.icon className="h-[18px] w-[18px]" /></div>
          <div className="text-[25px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">{stat.value}</div>
          <div className="mt-0.5 text-[12.5px] text-slate-500 sm:text-[13px]">{stat.label}</div>
        </>
        const className = `rounded-2xl border border-[#e6ebf1] bg-white p-[15px_16px] shadow-panel transition-all sm:p-[18px] ${stat.hoverClass}`
        return stat.href
          ? <Link key={stat.label} href={stat.href} className={className}>{inner}</Link>
          : <div key={stat.label} className={className}>{inner}</div>
      })}
    </div>

    <div className="grid grid-cols-3 gap-3">
      {[
        { icon: Upload, label: "Upload", count: documentsThisMonth, desc: "documents this month", href: `/workspaces/${workspaceId}/pipeline`, color: "bg-indigo-50 text-indigo-600" },
        { icon: ListChecks, label: "Review", count: stageCounts.to_review, desc: "awaiting review", href: `/workspaces/${workspaceId}/pipeline?stage=to_review`, color: "bg-amber-50 text-amber-600" },
        { icon: Table2, label: "Sheets", count: stageCounts.ready + stageCounts.archive, desc: unplacedCount > 0 ? `ready to use · ${unplacedCount} not in a sheet` : "ready to use", href: `/workspaces/${workspaceId}/files`, color: "bg-emerald-50 text-emerald-700" },
      ].map((step, i) => (
        <Link key={step.label} href={step.href} className="group flex items-center gap-3 rounded-xl border border-[#e6ebf1] bg-white px-4 py-3 shadow-panel transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${step.color}`}><step.icon className="h-[17px] w-[17px]" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
              {step.label}
              {i < 2 && <ArrowRight className="h-3 w-3 text-slate-300" />}
            </div>
            <div className="text-[12px] text-slate-500">{step.count} {step.desc}</div>
          </div>
        </Link>
      ))}
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
      <div className="order-2 overflow-hidden rounded-2xl border border-[#e6ebf1] bg-white shadow-panel lg:order-none">
        <div className="flex items-center justify-between border-b border-b-[#eef2f6] px-5 py-4">
          <h2 className="text-[15px] font-bold text-slate-900">Recent files</h2>
          <Link href={`/workspaces/${workspaceId}/files`} className="text-[13px] font-semibold text-emerald-700 hover:text-emerald-800">View all</Link>
        </div>
        {recentFiles.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">No files yet — upload something to get started.</p> : <div>
          {recentFiles.map((file) => {
            const reviewCount = recentFileReviewCounts[file.id] ?? 0
            return <Link key={file.id} href={`/workspaces/${workspaceId}/files/${file.id}`} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0 hover:bg-slate-50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700"><Table2 className="h-[17px] w-[17px]" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
                <div className="text-xs text-slate-400">{file._count.documents} document{file._count.documents === 1 ? "" : "s"}{file.folder ? ` · in ${file.folder.name}` : ""}</div>
              </div>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${reviewCount > 0 ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>
                {reviewCount > 0 ? `${reviewCount} in review` : "Done"}
              </span>
              <span className="w-[74px] shrink-0 text-right text-xs text-slate-400"><LastUpdated iso={file.updatedAt.toISOString()} /></span>
            </Link>
          })}
        </div>}
      </div>

      <div className="order-1 rounded-2xl border border-[#e6ebf1] bg-white p-[18px] shadow-panel lg:order-none lg:p-5">
        <div className="mb-3.5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><SearchCheck className="h-[17px] w-[17px]" /></span>
          <h2 className="text-[15px] font-bold text-slate-900">Needs your review</h2>
          {stageCounts.to_review > 0 && <span className="ml-auto rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11.5px] font-bold text-indigo-700">{stageCounts.to_review}</span>}
        </div>
        {needsReview.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nothing needs a look right now.</p> : <>
          {needsReview.slice(0, 3).map((doc) => {
            const reasons = flaggedFieldsFromConfidence(doc.confidence).slice(0, 2).map(formatFieldKey)
            const review = summarizeDocumentForReview(doc)
            return <Link key={doc.id} href={`/workspaces/${workspaceId}/documents/${doc.id}?stage=to_review`} className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0 hover:text-emerald-800">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-slate-800">{review.supplier ?? "Unknown supplier"} · {review.category}{review.total ? ` · ${review.total}` : ""}</div>
                <div className="text-xs text-slate-500">{reasons.length > 0 ? `${reasons.join(", ")} unclear` : "Ready for a look"}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          })}
        </>}
        <Link href={`/workspaces/${workspaceId}/pipeline?stage=to_review`} className="mt-3.5 block rounded-[11px] bg-slate-900 px-3 py-2.5 text-center text-[13.5px] font-semibold text-white hover:bg-slate-800">
          Open the review queue →
        </Link>
      </div>
    </div>

    <GettingStartedCard
      workspaceId={workspaceId}
      initialState={onboardingState}
      liveCounts={{ uploaded: documentsThisMonth, approved: stageCounts.ready + stageCounts.archive, placedInSheet: (stageCounts.ready + stageCounts.archive) - unplacedCount }}
    />
  </main>
}
