// Deliberately NOT a "use server" module, for the same reason as models/files.ts: these helpers
// trust a caller-supplied workspaceId that is assumed already authorised, and the directive would
// publish every export as a callable endpoint. Auth lives in the actions that call these.
import { prisma } from "@/lib/db"
import type { DictationFormat } from "@/lib/dictation/formats"
import { DEFAULT_REPORT_TEMPLATES } from "@/lib/report-templates"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { parseSynopticFields } from "@/lib/report-render/synoptic"
import type { Prisma } from "@/prisma/client"

/** Report templates: creating the built-ins, and editing them.
 *
 * Before this, `findReportTemplate` was the only code in the repo that touched the table and
 * nothing ever wrote a row — so `createReportDraft` returned null unconditionally and the whole
 * verified drafting pipeline was unreachable. This is the missing half. */

/** Creates the built-in templates for a workspace if they are not already there.
 *
 * Idempotent and safe to call on every page load: it upserts on the existing
 * @@unique([workspaceId, name]) and only ever writes on create, so a workspace that has since
 * edited its slots in Settings does not get them reset by the next visit. */
export async function ensureWorkspaceReportTemplates(workspaceId: string) {
  await Promise.all(DEFAULT_REPORT_TEMPLATES.map((seed) => prisma.reportTemplate.upsert({
    where: { workspaceId_name: { workspaceId, name: seed.name } },
    update: {},
    create: {
      workspaceId,
      name: seed.name,
      specimenType: seed.specimenType,
      synopticFields: seed.synopticFields as unknown as Prisma.InputJsonValue,
      narrativeSections: seed.narrativeSections as unknown as Prisma.InputJsonValue,
      isSystem: true,
    },
  })))
}

/** The name (and lookup key) a format's per-workspace ReportTemplate row is stored under. */
const formatTemplateName = (label: string) => `Format — ${label}`

/** Gets or creates the ReportTemplate row a resolved dictation format drafts against.
 *
 * Agnostic dictation resolves a FORMAT (lib/dictation/pipeline.ts), not a specimen type, so it
 * cannot go through findReportTemplate's specimenType matching — and must not: sharing
 * `specimenType: null` with the workspace's real fallback template would make that lookup
 * nondeterministic between two rows that both claim to be "the" fallback. Instead this is looked up
 * BY NAME, keyed one-to-one with the format, with `specimenType` set to a value
 * (`format:<name>`) that can never collide with a real dictated specimen type.
 *
 * Upserts on the existing @@unique([workspaceId, name]) with `update: {}`, matching
 * ensureWorkspaceReportTemplates' policy exactly: a workspace that has since customised this
 * format's wording in the template editor keeps that customisation on the next dictation that
 * resolves to the same format, rather than being silently reset to the registry's default text. */
export async function ensureFormatReportTemplate(workspaceId: string, format: DictationFormat) {
  const name = formatTemplateName(format.label)
  return prisma.reportTemplate.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: {},
    create: {
      workspaceId,
      name,
      specimenType: `format:${format.name}`,
      // Empty means "derive from the document's own discovered fields at draft time" — see
      // deriveSynopticFields / createReportDraft — which is what every agnostic dictation needs
      // regardless of format, since its field schema is not known ahead of time.
      synopticFields: [] as unknown as Prisma.InputJsonValue,
      narrativeSections: format.sections as unknown as Prisma.InputJsonValue,
      isSystem: true,
    },
  })
}

export async function listReportTemplates(workspaceId: string) {
  return prisma.reportTemplate.findMany({ where: { workspaceId }, orderBy: { name: "asc" } })
}

export async function getReportTemplate(workspaceId: string, templateId: string) {
  return prisma.reportTemplate.findFirst({ where: { id: templateId, workspaceId } })
}

/** Updates a template's slots and sections.
 *
 * Both halves go through the same Zod parsers the renderer uses, so an edit that would make a
 * template unrenderable is refused at the point of saving rather than at the point a pathologist
 * presses Draft. The keys are what renderSynoptic and renderNarrative look values up by, which is
 * why a malformed key is a hard failure and not a best effort. */
export async function updateReportTemplate(input: {
  workspaceId: string
  templateId: string
  name?: string
  specimenType?: string | null
  synopticFields: unknown
  narrativeSections: unknown
}) {
  const existing = await getReportTemplate(input.workspaceId, input.templateId)
  if (!existing) throw new Error("report_template_not_found")

  const synopticFields = parseSynopticFields(input.synopticFields)
  const narrativeSections = parseNarrativeSections(input.narrativeSections)

  return prisma.reportTemplate.update({
    where: { id: existing.id },
    data: {
      ...(input.name?.trim() ? { name: input.name.trim().slice(0, 120) } : {}),
      ...(input.specimenType !== undefined ? { specimenType: input.specimenType?.trim() || null } : {}),
      synopticFields: synopticFields as unknown as Prisma.InputJsonValue,
      narrativeSections: narrativeSections as unknown as Prisma.InputJsonValue,
    },
  })
}
