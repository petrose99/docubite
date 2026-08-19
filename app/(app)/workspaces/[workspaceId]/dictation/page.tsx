import { DictationList } from "@/components/dictation/dictation-list"
import { NewDictation } from "@/components/dictation/new-dictation"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { dictationAdapters } from "@/lib/domains"
import { ensureDictationFile } from "@/models/files"
import { ensureWorkspaceReportTemplates } from "@/models/report-templates"
import { requireWorkspaceRole } from "@/models/workspaces"
import { Mic } from "lucide-react"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** The dictation index: record a new case, or pick up one already recorded.
 *
 * Deliberately not the spreadsheet. A dictated pathology report is a clinical document somebody
 * reads back and signs, not a row — the extract panel's staged-file list was the wrong shape for
 * it and gave speech no front door of its own. */
export default async function DictationPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  // 404 rather than a disabled screen: with no ASR backend there is nothing here to show, and the
  // rail does not link to it either.
  if (!config.asr.enabled) notFound()

  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  // Idempotent, and cheap after the first visit. Done here rather than in a migration or a startup
  // hook so an existing workspace gets its dictation container and report template the first time
  // somebody actually opens the page.
  await Promise.all([
    ensureDictationFile(workspaceId, user.id),
    ensureWorkspaceReportTemplates(workspaceId),
  ])

  const dictations = await prisma.document.findMany({
    where: { workspaceId, source: "dictation" },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true, filename: true, status: true, receivedAt: true, errorCode: true,
      transcriptEditedAt: true, reviewedData: true,
      template: { select: { name: true, code: true } },
      reportDrafts: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, status: true, signedAt: true } },
    },
  })

  const templates = dictationAdapters().map((adapter) => ({ code: adapter.code, name: adapter.name }))

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <Mic className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">Dictation</h1>
          <p className="mt-1 text-sm text-stone-500">
            Dictate a case, check the transcription against the audio, then draft and sign the report.
          </p>
        </div>
      </header>

      <NewDictation workspaceId={workspaceId} templates={templates} />

      <DictationList
        workspaceId={workspaceId}
        dictations={dictations.map((dictation) => ({
          id: dictation.id,
          filename: dictation.filename,
          status: dictation.status,
          errorCode: dictation.errorCode,
          receivedAt: dictation.receivedAt.toISOString(),
          transcriptEdited: Boolean(dictation.transcriptEditedAt),
          templateName: dictation.template?.name ?? "Dictation",
          summary: summarise(dictation.reviewedData),
          draft: dictation.reportDrafts[0]
            ? {
                version: dictation.reportDrafts[0].version,
                status: dictation.reportDrafts[0].status,
                signedAt: dictation.reportDrafts[0].signedAt?.toISOString() ?? null,
              }
            : null,
        }))}
      />
    </main>
  )
}

/** A one-line "what case is this" for the list. Reads only the two fields that identify a case;
 * the diagnosis deliberately does not appear in a list view. */
function summarise(reviewedData: unknown): string | null {
  if (!reviewedData || typeof reviewedData !== "object") return null
  const values = reviewedData as Record<string, unknown>
  const parts = [values.accession_no, values.specimen_type, values.anatomical_site]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  return parts.length ? parts.join(" · ") : null
}
