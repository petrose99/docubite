import { parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { biasTermsForTemplate } from "@/lib/domains"
import { parseDictationRoutingRecord } from "@/lib/dictation/pipeline"
import { resolveFormat } from "@/lib/dictation/formats"
import { buildCompletenessReport, type CompletenessReport } from "@/lib/report-completeness"
import { NOT_DICTATED, parseNarrativeSections, renderNarrative } from "@/lib/report-render/narrative"
import { parseSynopticFields, renderSynoptic, renderSynopticText, type SynopticLine } from "@/lib/report-render/synoptic"
import { deriveSynopticFields } from "@/lib/report-templates"
import { ensureFormatReportTemplate } from "@/models/report-templates"
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

/** The synoptic block's heading. Neutral rather than clinical — "DIAGNOSIS / SYNOPTIC" was
 * pathology-specific wording that made no sense on a general report, and every consumer that once
 * looked for that literal (signReport, updateReportDraftNarrative) has been switched to reading
 * `draft.synoptic` directly instead of parsing this heading back out of rendered text. */
const SYNOPTIC_HEADING = "SUMMARY"

/** Assembles the full report text: banner (drafts only), title, synoptic block, then narrative
 * sections. `title` is the dictation's own title (Document.filename or an accepted
 * `_suggested_title`) — the report otherwise has no name of its own once it stops being "the
 * pathology report for case #…". */
export function renderReportText(params: {
  signed: boolean
  title?: string
  synopticText: string
  narrative: Record<string, string>
  sections: { key: string; title: string }[]
}): string {
  const blocks: string[] = []
  if (!params.signed) blocks.push(DRAFT_BANNER)
  if (params.title?.trim()) blocks.push(params.title.trim())
  if (params.synopticText.trim()) blocks.push(`${SYNOPTIC_HEADING}\n${params.synopticText}`)
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
    select: { id: true, filename: true, ocrText: true, reviewedData: true, rawExtraction: true, fieldSnapshot: true, dictationRouting: true, template: { select: { code: true } } },
  })
  if (!document) throw new Error("document_not_found")

  const values = ((document.reviewedData ?? document.rawExtraction) as Record<string, unknown> | null) ?? {}

  // Agnostic dictation resolves a FORMAT (lib/dictation/pipeline.ts), which selects a template by
  // name rather than by specimen type — see ensureFormatReportTemplate for why the two lookups
  // cannot share the specimenType channel. Absent (the common case: DICTATION_ROUTER_ENABLED off,
  // or a template-mode dictation with routing never run) falls through to the specimen-type lookup
  // exactly as before this feature existed.
  const routing = parseDictationRoutingRecord(document.dictationRouting)
  const template = routing
    ? await ensureFormatReportTemplate(input.workspaceId, resolveFormat(routing.format))
    : await findReportTemplate(input.workspaceId, typeof values.specimen_type === "string" ? values.specimen_type : null)
  if (!template) return null

  // An empty synopticFields list means "derive from what this document actually has" rather than a
  // fixed slot list (lib/report-templates.ts) — the general report template's default, and what
  // makes a discovered field set actually reach the report instead of being invisible once accepted.
  const templateSlots = parseSynopticFields(template.synopticFields)
  const synopticFields = templateSlots.length ? templateSlots : deriveSynopticFields(parseTemplateFields(document.fieldSnapshot))
  const sections = parseNarrativeSections(template.narrativeSections)

  // Deterministic half first, and independent of the LLM: even if narrative generation fails
  // entirely, the synoptic block — the part carrying the diagnosis — is still exactly the
  // dictated values with visible markers where there were none.
  const synoptic = renderSynoptic(synopticFields, values)
  // Stage B (lib/dictation/extraction.ts) separates spoken META-COMMANDS ("make this a table")
  // from the dictated CONTENT, but only for routing/format resolution — it was never wired into
  // what the narrative half actually reads, so a command survived verbatim into a drafted report
  // (caught live: "Make this a table." showed up under DETAILS). `commands` are the model's own
  // verbatim quotes of what it excluded, so stripping those exact substrings out of the transcript
  // here gets the same effect without needing to persist Stage B's full cleaned_content separately.
  const narrativeSource = routing?.commands.length
    ? routing.commands.reduce((text, command) => text.split(command).join(" "), document.ocrText).replace(/\s+/g, " ").trim()
    : document.ocrText
  const narrative = await renderNarrative(sections, narrativeSource, values, biasTermsForTemplate(document.template?.code))
  const completeness = buildCompletenessReport(synoptic, narrative, Object.fromEntries(sections.map((section) => [section.key, section.title])))
  const renderedText = renderReportText({ signed: false, title: document.filename, synopticText: synoptic.text, narrative, sections })

  const previous = await prisma.documentReportDraft.findFirst({ where: { documentId: document.id }, orderBy: { version: "desc" }, select: { version: true } })
  const draft = await prisma.documentReportDraft.create({
    data: {
      workspaceId: input.workspaceId,
      documentId: document.id,
      templateId: template.id,
      status: "draft",
      version: (previous?.version ?? 0) + 1,
      // The full lines (label, value, missing, required) — not just key->value — so a later
      // re-render (signReport, updateReportDraftNarrative) can reproduce this exact text without
      // re-deriving it from live document values, which may have moved on since this draft.
      synoptic: synoptic.lines as unknown as Prisma.InputJsonValue,
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
    include: { template: true, document: { select: { filename: true } } },
  })
  if (!draft) throw new Error("report_draft_not_found")
  if (draft.status === "signed") throw new Error("report_already_signed")

  const sections = draft.template ? parseNarrativeSections(draft.template.narrativeSections) : []
  // Re-derived from the stored lines (see createReportDraft), not parsed back out of the previous
  // renderedText — a heading is UI, not data, and round-tripping through it broke the moment the
  // heading stopped being a fixed clinical literal.
  const synopticText = renderSynopticText((draft.synoptic ?? []) as unknown as SynopticLine[])
  const renderedText = renderReportText({
    signed: true,
    title: draft.document.filename,
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

/** Edits a draft's narrative prose and re-renders it.
 *
 * REFUSES A SIGNED DRAFT. A signed report is a clinical document with someone's name on it; the
 * text they signed must stay exactly the text they signed, so a correction after sign-off is a new
 * draft version (createReportDraft already versions), never a rewrite of the old one.
 *
 * Only the narrative half is editable. The synoptic block is rendered deterministically from the
 * extracted values, and letting it be typed over would sever the one link between what the report
 * says and what was actually dictated — correcting a synoptic slot means correcting the field it
 * came from, which re-projects the structured spine with it. */
export async function updateReportDraftNarrative(input: { workspaceId: string; draftId: string; narrative: Record<string, string> }) {
  const draft = await prisma.documentReportDraft.findFirst({
    where: { id: input.draftId, workspaceId: input.workspaceId },
    include: { template: true, document: { select: { filename: true } } },
  })
  if (!draft) throw new Error("report_draft_not_found")
  if (draft.status !== "draft") throw new Error("report_already_signed")

  const sections = draft.template ? parseNarrativeSections(draft.template.narrativeSections) : []
  // Iterates the template's sections, never the submitted keys, so a request naming a section the
  // template does not have cannot introduce one — the same rule renderSynoptic follows.
  const current = (draft.narrative ?? {}) as Record<string, string>
  const narrative = Object.fromEntries(sections.map((section) => {
    const submitted = input.narrative[section.key]
    const text = typeof submitted === "string" ? submitted.trim() : ""
    return [section.key, text || current[section.key] || NOT_DICTATED]
  }))

  const synopticText = renderSynopticText((draft.synoptic ?? []) as unknown as SynopticLine[])

  return prisma.documentReportDraft.update({
    where: { id: draft.id },
    data: {
      narrative: narrative as Prisma.InputJsonValue,
      renderedText: renderReportText({ signed: false, title: draft.document.filename, synopticText, narrative, sections }),
    },
  })
}

export async function getReportDraft(workspaceId: string, draftId: string) {
  return prisma.documentReportDraft.findFirst({ where: { id: draftId, workspaceId }, include: { template: true } })
}

export async function listDocumentReportDrafts(workspaceId: string, documentId: string) {
  return prisma.documentReportDraft.findMany({ where: { workspaceId, documentId }, orderBy: { version: "desc" } })
}

/** Answers Stage 4's clarifying question: a person picking the format directly, because the router
 * (lib/dictation/pipeline.ts::checkDictationAmbiguity) was not confident enough to decide it alone.
 * Records the choice as "explicit" — a human picking from a list IS the strongest signal there is,
 * the same standing an explicitly spoken format already has — and clears `needsClarification` so
 * the verify screen's prompt does not keep asking once it has been answered. Then drafts (or
 * re-drafts, versioned) exactly as any other format resolution would. */
export async function applyDictationFormatChoice(input: { workspaceId: string; documentId: string; formatName: string }) {
  const document = await prisma.document.findFirst({ where: { id: input.documentId, workspaceId: input.workspaceId }, select: { dictationRouting: true } })
  if (!document) throw new Error("document_not_found")

  const format = resolveFormat(input.formatName)
  const existing = parseDictationRoutingRecord(document.dictationRouting)
  const persisted = {
    intent: existing?.intent ?? "general",
    format: format.name,
    formatLabel: format.label,
    formatSource: "explicit",
    routeScore: existing?.routeScore ?? 0,
    routeVia: existing?.routeVia ?? "clarified",
    commands: existing?.commands ?? [],
    needsClarification: false,
    clarificationReason: null,
  }
  await prisma.document.update({ where: { id: input.documentId }, data: { dictationRouting: persisted as unknown as Prisma.InputJsonValue } })

  return createReportDraft({ workspaceId: input.workspaceId, documentId: input.documentId })
}
