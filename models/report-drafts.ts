import { prisma } from "@/lib/db"
import { buildCompletenessReport, type CompletenessReport } from "@/lib/report-completeness"
import { parseNarrativeSections, renderNarrative } from "@/lib/report-render/narrative"
import { parseSynopticFields, renderSynoptic } from "@/lib/report-render/synoptic"
import { biasTermsForTemplate } from "@/lib/domains"
import type { Prisma } from "@/prisma/client"

/** Report drafting and the sign-off boundary.
 *
 * The clinical invariant of this feature lives here: a draft is created "draft", and the only
 * function in the codebase that writes "signed" is signReport below. Nothing auto-finalises,
 * nothing auto-files, and the database's CHECK constraints refuse a "signed" row without both a
 * signer and a timestamp even if some future code path tries. */

/** The banner every unsigned draft carries. Part of the rendered text itself, not a UI decoration,
 * so it survives copy-paste, export, and print — the ways a draft actually escapes the screen. */
export const DRAFT_BANNER = "*** DRAFT — UNSIGNED — NOT FOR CLINICAL USE ***"

export type ReportDraftResult = {
  draftId: string
  renderedText: string
  completeness: CompletenessReport
  status: "draft" | "signed"
}

/** Picks the template for a specimen: an exact specimen match first, the workspace's fallback
 * (specimenType null) second. Returns null when the workspace has configured neither, in which case
 * no report is drafted — inventing a format would be worse than declining. */
export async function findReportTemplate(workspaceId: string, specimenType: string | null) {
  if (specimenType) {
    const exact = await prisma.reportTemplate.findFirst({ where: { workspaceId, specimenType: { equals: specimenType, mode: "insensitive" } } })
    if (exact) return exact
  }
  return prisma.reportTemplate.findFirst({ where: { workspaceId, specimenType: null } })
}

/** Assembles the full report text: banner (drafts only), synoptic block, then narrative sections. */
export function renderReportText(params: {
  signed: boolean
  synopticText: string
  narrative: Record<string, string>
  sections: { key: string; title: string }[]
}): string {
  const blocks: string[] = []
  if (!params.signed) blocks.push(DRAFT_BANNER)
  if (params.synopticText.trim()) blocks.push(`DIAGNOSIS / SYNOPTIC\n${params.synopticText}`)
  for (const section of params.sections) {
    const text = params.narrative[section.key]
    if (text) blocks.push(`${section.title.toUpperCase()}\n${text}`)
  }
  return blocks.join("\n\n")
}

/** Drafts a report for one document. Always produces status "draft".
 *
 * Versioned rather than overwritten: re-drafting after a correction keeps the previous draft, so
 * what a signer saw is still recoverable. */
export async function createReportDraft(input: { workspaceId: string; documentId: string }): Promise<ReportDraftResult | null> {
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, workspaceId: input.workspaceId },
    select: { id: true, ocrText: true, reviewedData: true, rawExtraction: true, template: { select: { code: true } } },
  })
  if (!document) throw new Error("document_not_found")

  const values = ((document.reviewedData ?? document.rawExtraction) as Record<string, unknown> | null) ?? {}
  const specimenType = typeof values.specimen_type === "string" ? values.specimen_type : null
  const template = await findReportTemplate(input.workspaceId, specimenType)
  if (!template) return null

  const synopticFields = parseSynopticFields(template.synopticFields)
  const sections = parseNarrativeSections(template.narrativeSections)

  // Deterministic half first, and independent of the LLM: even if narrative generation fails
  // entirely, the synoptic block — the part carrying the diagnosis — is still exactly the
  // dictated values with visible markers where there were none.
  const synoptic = renderSynoptic(synopticFields, values)
  const narrative = await renderNarrative(sections, document.ocrText, values, biasTermsForTemplate(document.template?.code))
  const completeness = buildCompletenessReport(synoptic, narrative, Object.fromEntries(sections.map((section) => [section.key, section.title])))
  const renderedText = renderReportText({ signed: false, synopticText: synoptic.text, narrative, sections })

  const previous = await prisma.documentReportDraft.findFirst({ where: { documentId: document.id }, orderBy: { version: "desc" }, select: { version: true } })
  const draft = await prisma.documentReportDraft.create({
    data: {
      workspaceId: input.workspaceId,
      documentId: document.id,
      templateId: template.id,
      status: "draft",
      version: (previous?.version ?? 0) + 1,
      synoptic: Object.fromEntries(synoptic.lines.map((line) => [line.key, line.value])) as Prisma.InputJsonValue,
      narrative: narrative as Prisma.InputJsonValue,
      renderedText,
      missingFields: completeness as unknown as Prisma.InputJsonValue,
    },
  })

  return { draftId: draft.id, renderedText, completeness, status: "draft" }
}

/** THE ONLY PATH THAT SIGNS A REPORT.
 *
 * Requires an authenticated actor, refuses a draft that is already signed, and records a
 * report_signed audit event in the same transaction as the status change. The re-render drops the
 * DRAFT banner, so signed text is not a draft with a line deleted from it.
 *
 * Completeness is reported to the caller but deliberately does NOT block: a pathologist may sign a
 * report where an optional section was never dictated, and that judgement is theirs. What the
 * system guarantees is that they cannot sign one without the gaps having been rendered visibly in
 * the text they are signing. */
export async function signReport(input: { workspaceId: string; draftId: string; actorId: string }) {
  const draft = await prisma.documentReportDraft.findFirst({
    where: { id: input.draftId, workspaceId: input.workspaceId },
    include: { template: true },
  })
  if (!draft) throw new Error("report_draft_not_found")
  if (draft.status === "signed") throw new Error("report_already_signed")

  const sections = draft.template ? parseNarrativeSections(draft.template.narrativeSections) : []
  const synopticText = draft.renderedText
    .split("\n\n")
    .find((block) => block.startsWith("DIAGNOSIS / SYNOPTIC\n"))
    ?.replace("DIAGNOSIS / SYNOPTIC\n", "") ?? ""
  const renderedText = renderReportText({
    signed: true,
    synopticText,
    narrative: (draft.narrative ?? {}) as Record<string, string>,
    sections,
  })

  const [signed] = await prisma.$transaction([
    prisma.documentReportDraft.update({
      where: { id: draft.id },
      data: { status: "signed", signedById: input.actorId, signedAt: new Date(), renderedText },
    }),
    prisma.documentAuditEvent.create({
      data: { workspaceId: input.workspaceId, documentId: draft.documentId, actorId: input.actorId, type: "report_signed" },
    }),
  ])
  return signed
}

export async function getReportDraft(workspaceId: string, draftId: string) {
  return prisma.documentReportDraft.findFirst({ where: { id: draftId, workspaceId }, include: { template: true } })
}

export async function listDocumentReportDrafts(workspaceId: string, documentId: string) {
  return prisma.documentReportDraft.findMany({ where: { workspaceId, documentId }, orderBy: { version: "desc" } })
}
