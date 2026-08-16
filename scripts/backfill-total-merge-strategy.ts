import { DEFAULT_DOCUMENT_TEMPLATES, DocumentFieldDefinition, parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"

/** One-off backfill: tags the total fields of every system Invoice and Receipt template with
 * `mergeStrategy: "last"`, so multi-page extraction keeps the totals row from the page it is
 * actually printed on instead of an earlier batch's guess. Templates seeded before the flag
 * existed have no strategy at all, which reads as first-pass-wins.
 *
 * Patches the fields in place rather than replacing them with the current defaults, so a
 * workspace that added its own fields to a system template keeps them. Also stamps the
 * snapshot of documents that have not been extracted yet, since extraction reads each
 * document's own `fieldSnapshot` and not the template. Safe to re-run. */

/** Keys the shipped defaults mark as last-page summaries, in either system template. */
const SUMMARY_KEYS = new Set(
  DEFAULT_DOCUMENT_TEMPLATES.filter((template) => template.code === "invoice" || template.code === "receipt")
    .flatMap((template) => parseTemplateFields(template.fields))
    .filter((field) => field.mergeStrategy === "last")
    .map((field) => field.key),
)

function needsPatch(fields: DocumentFieldDefinition[]) {
  return fields.some((field) => SUMMARY_KEYS.has(field.key) && field.type !== "array" && !field.mergeStrategy)
}

function patched(fields: DocumentFieldDefinition[]) {
  return fields.map((field) => (SUMMARY_KEYS.has(field.key) && field.type !== "array" && !field.mergeStrategy ? { ...field, mergeStrategy: "last" as const } : field))
}

async function backfillTemplates() {
  const templates = await prisma.documentTemplate.findMany({
    where: { code: { in: ["invoice", "receipt"] }, isSystem: true },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  })

  let updated = 0
  for (const template of templates) {
    const current = template.versions[0]
    if (!current) continue
    const currentFields = parseTemplateFields(current.fields)
    if (!needsPatch(currentFields)) continue

    await prisma.$transaction([
      prisma.documentTemplate.update({ where: { id: template.id }, data: { currentVersion: { increment: 1 } } }),
      prisma.documentTemplateVersion.create({ data: { templateId: template.id, version: template.currentVersion + 1, fields: patched(currentFields), prompt: current.prompt } }),
    ])
    updated++
  }
  return { updated, total: templates.length }
}

/** Documents with no extraction yet are the ones that will still be run through the merge,
 * whether they are queued, mid-flight, or waiting on a retry after a failure. */
async function backfillPendingDocumentSnapshots() {
  const documents = await prisma.document.findMany({ where: { rawExtraction: { equals: Prisma.DbNull } }, select: { id: true, fieldSnapshot: true } })

  let updated = 0
  for (const document of documents) {
    let fields: DocumentFieldDefinition[]
    try {
      fields = parseTemplateFields(document.fieldSnapshot)
    } catch {
      console.warn(`Skipped document ${document.id}: field snapshot does not parse`)
      continue
    }
    if (!needsPatch(fields)) continue
    await prisma.document.update({ where: { id: document.id }, data: { fieldSnapshot: patched(fields) as Prisma.InputJsonValue } })
    updated++
  }
  return { updated, total: documents.length }
}

async function main() {
  if (!SUMMARY_KEYS.size) throw new Error("default_templates_declare_no_summary_fields")
  const templates = await backfillTemplates()
  const documents = await backfillPendingDocumentSnapshots()
  console.info(`Tagged ${[...SUMMARY_KEYS].join(", ")} as last-page summaries on ${templates.updated} of ${templates.total} system template(s) and ${documents.updated} of ${documents.total} unextracted document snapshot(s).`)
}

main()
  .catch((error) => {
    console.error("Backfill failed", error instanceof Error ? error.message : "unknown_error")
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
