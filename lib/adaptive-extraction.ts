import config from "@/lib/config"
import { discoverItemFields } from "@/lib/document-suggest"
import type { PageContent } from "@/lib/document-processing"
import { DocumentFieldDefinition, DocumentItemFieldDefinition, documentTemplateFieldsSchema, parseTemplateFields } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
import { buildShapeSignature, scoreShapeMatch } from "@/lib/shape-match"

/** Whether adaptive line-item discovery runs for this document: the document's own tri-state
 * override (set by the "Re-extract adaptively" action) takes precedence; otherwise the global
 * config flag decides. */
export function adaptiveEnabled(document: { adaptiveExtraction: boolean | null }): boolean {
  return document.adaptiveExtraction ?? config.documents.adaptiveExtraction
}

function findArrayField(fields: DocumentFieldDefinition[]): DocumentFieldDefinition | null {
  return fields.find((field) => field.type === "array" && field.itemFields?.length) ?? null
}

/** Unions a template's array field's item columns with a discovered set, template keys first so the
 * cap can never drop a canonical column (description/quantity/unit_price/amount) that a downstream
 * consumer like lib/integration-bill-mapping.ts reads by hardcoded key. Only that one array field's
 * itemFields are replaced — every other field, and its own key/label/type/required/order, is
 * untouched. Returns `templateFields` unchanged if there is no array field to merge into, or if the
 * merged result fails schema validation. */
export function mergeDiscoveredFields(templateFields: DocumentFieldDefinition[], discoveredItemFields: DocumentItemFieldDefinition[]): DocumentFieldDefinition[] {
  const arrayField = findArrayField(templateFields)
  if (!arrayField || !arrayField.itemFields) return templateFields
  const seen = new Set<string>()
  const merged: DocumentItemFieldDefinition[] = []
  for (const item of [...arrayField.itemFields, ...discoveredItemFields]) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    merged.push(item)
    if (merged.length >= 20) break
  }
  const mergedFields = templateFields.map((field) => (field === arrayField ? { ...field, itemFields: merged } : field))
  const parsed = documentTemplateFieldsSchema.safeParse(mergedFields)
  return parsed.success ? parsed.data : templateFields
}

/** True when a saved shape's array field already carries more item columns than the current
 * template's array field — i.e. a prior adaptive run already enriched it, and matches closely
 * enough on layout that its enriched columns are safe to reuse without paying for another
 * discovery call. */
function hasEnrichedArrayField(shapeFields: DocumentFieldDefinition[], templateArrayField: DocumentFieldDefinition): boolean {
  const shapeArrayField = shapeFields.find((field) => field.key === templateArrayField.key && field.type === "array")
  return (shapeArrayField?.itemFields?.length ?? 0) > (templateArrayField.itemFields?.length ?? 0)
}

const SHAPE_REUSE_THRESHOLD = 0.62

/** Derives the fields to extract this document against: the template's fields unchanged unless
 * adaptive extraction is enabled and the template has a line-item array field, in which case the
 * document's real line-item columns are discovered (or reused from a closely-matching prior run of
 * the same template) and merged in. Never throws — any failure at any step falls back to
 * `templateFields`, exactly today's behavior, mirroring lib/document-transcription.ts's
 * applyDictationRouting contract. */
export async function deriveAdaptiveFields(input: {
  document: { templateId: string | null; adaptiveExtraction: boolean | null }
  templateFields: DocumentFieldDefinition[]
  contents: PageContent[]
}): Promise<DocumentFieldDefinition[]> {
  const { document, templateFields, contents } = input
  try {
    if (!adaptiveEnabled(document)) return templateFields
    const arrayField = findArrayField(templateFields)
    if (!arrayField) return templateFields

    if (document.templateId) {
      const shape = await prisma.extractionShape.findUnique({ where: { templateId: document.templateId }, select: { fields: true, signature: true } })
      if (shape) {
        const firstPageText = (contents.find((content) => content.page === 1)?.text ?? contents[0]?.text ?? "").slice(0, 4000)
        const probe = buildShapeSignature({ firstPageText })
        const score = scoreShapeMatch(shape.signature as unknown as Parameters<typeof scoreShapeMatch>[0], probe)
        if (score >= SHAPE_REUSE_THRESHOLD) {
          const shapeFields = parseTemplateFields(shape.fields)
          if (hasEnrichedArrayField(shapeFields, arrayField)) return shapeFields
        }
      }
    }

    const discovered = await discoverItemFields(contents, arrayField.itemFields ?? [])
    return mergeDiscoveredFields(templateFields, discovered)
  } catch {
    return templateFields
  }
}
