import { DEFAULT_DOCUMENT_TEMPLATES } from "@/lib/document-templates"
import { prisma } from "@/lib/db"

/** One-off backfill: turns on multi-row mode for the system Invoice and Receipt templates of
 * every workspace seeded before `multiRow` defaulted to true. Without it those sheets render
 * their line items as a read-only "N items" summary column instead of one grid row per item.
 *
 * `multiRow` lives on the template row, not on a version, so this needs no version bump and
 * no reprocessing: already-extracted documents render as item rows on the next page load.
 * Only flips templates that are still off, and only the codes the shipped defaults mark as
 * multi-row, so a workspace that deliberately switched a sheet back stays switched back only
 * until it is re-run — re-running is otherwise a no-op. */

const MULTI_ROW_CODES = DEFAULT_DOCUMENT_TEMPLATES.filter((template) => template.multiRow).map((template) => template.code)

async function main() {
  if (!MULTI_ROW_CODES.length) throw new Error("default_templates_declare_no_multi_row_sheets")
  const { count } = await prisma.documentTemplate.updateMany({
    where: { code: { in: [...MULTI_ROW_CODES] }, isSystem: true, multiRow: false },
    data: { multiRow: true },
  })
  const total = await prisma.documentTemplate.count({ where: { code: { in: [...MULTI_ROW_CODES] }, isSystem: true } })
  console.info(`Enabled multi-row line items on ${count} of ${total} system ${MULTI_ROW_CODES.join("/")} template(s).`)
}

main()
  .catch((error) => {
    console.error("Backfill failed", error instanceof Error ? error.message : "unknown_error")
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
