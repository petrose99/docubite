import { DictationList } from "@/components/dictation/dictation-list"
import { NewDictation } from "@/components/dictation/new-dictation"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { parseTemplateFields } from "@/lib/document-templates"
import { isAsrAllowed } from "@/lib/asr/gating"
import { ensureDictationFile, getFileTemplates } from "@/models/files"
import { ensureWorkspaceReportTemplates } from "@/models/report-templates"
import { requireWorkspaceRole } from "@/models/workspaces"
import { Mic } from "lucide-react"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** The dictation index: record a new case, or pick up one already recorded.
 *
 * Deliberately not the spreadsheet. A dictated report is a document somebody reads back and signs,
 * not a row — the extract panel's staged-file list was the wrong shape for it and gave speech no
 * front door of its own. */
export default async function DictationPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  // 404 rather than a disabled screen: with no ASR backend, or in an accounting-mode workspace,
  // there is nothing here to show, and the rail does not link to it either.
  if (!config.asr.enabled || membership.workspace.productMode !== "clinical") notFound()

  // A confirmed BAA is what makes sending audio to the external ASR backend lawful for a
  // hipaaMode workspace (lib/asr/gating.ts) — a fact an admin has to confirm, not something the
  // page can route around. Shown here rather than a 404: the feature exists for this workspace,
  // it is just not switched on yet.
  if (!isAsrAllowed(membership.workspace)) {
    return <main className="mx-auto w-full max-w-2xl space-y-3 p-6 text-center">
      <h1 className="text-2xl font-bold text-stone-900">Dictation is pending BAA coverage</h1>
      <p className="text-sm text-stone-600">
        This workspace handles protected health information, and dictation sends audio to an external transcription
        provider. Recording is disabled here until a signed Business Associate Agreement covering that provider is
        confirmed for this workspace. Contact {config.app.supportEmail} to arrange one.
      </p>
    </main>
  }

  // Idempotent, and cheap after the first visit. Done here rather than in a migration or a startup
  // hook so an existing workspace gets its dictation container and report template the first time
  // somebody actually opens the page.
  const [file] = await Promise.all([
    ensureDictationFile(workspaceId, user.id),
    ensureWorkspaceReportTemplates(workspaceId),
  ])

  const dictations = await prisma.document.findMany({
    where: { workspaceId, source: "dictation" },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true, filename: true, status: true, receivedAt: true, errorCode: true,
      transcriptEditedAt: true, reviewedData: true, fieldSnapshot: true,
      template: { select: { name: true, code: true } },
      reportDrafts: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, status: true, signedAt: true } },
    },
  })

  // Every DocumentTemplate in the dictation file, not the fixed lib/domains code list: a workspace
  // can grow its own templates ("Save as a template" on the verify screen), and those must be
  // pickable here too. The single built-in row (general_report, isSystem, no fields) is relabeled
  // "Agnostic" for the picker — it IS the blank-slate template agnostic mode discovers fields onto,
  // just under a name that says what choosing it does rather than what it's called internally.
  // getFileTemplates orders isSystem first, so this stays the first option.
  const fileTemplates = await getFileTemplates(workspaceId, file.id)
  const templates = fileTemplates.map((template) => ({
    id: template.id,
    name: template.code === "general_report" ? "Agnostic — figure it out" : template.name,
  }))

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
          summary: summarise(dictation.fieldSnapshot, dictation.reviewedData),
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

/** A one-line "what case is this" for the list.
 *
 * Reads the document's own field order rather than three hard-coded pathology keys — a discover-
 * mode dictation (lib/domains/blank.ts) has no accession_no or specimen_type, so a fixed key list
 * would show nothing for it. The first few populated values, in the order the fields were defined,
 * are shown instead; capped at three so the list stays scannable. */
function summarise(fieldSnapshot: unknown, reviewedData: unknown): string | null {
  if (!reviewedData || typeof reviewedData !== "object") return null
  const values = reviewedData as Record<string, unknown>
  const fields = parseTemplateFields(fieldSnapshot)
  const parts = fields
    .map((field) => values[field.key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3)
  return parts.length ? parts.join(" · ") : null
}
