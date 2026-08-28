import type { DocumentFieldDefinition } from "@/lib/document-templates"
import { BLANK_BIAS_TERMS, BLANK_TEMPLATES } from "@/lib/domains/blank"
import { CONSTRUCTION_BIAS_TERMS, CONSTRUCTION_TEMPLATES } from "@/lib/domains/construction"
import { FINANCE_BIAS_TERMS, FINANCE_OPTIONAL_TEMPLATES, FINANCE_TEMPLATES } from "@/lib/domains/finance"
import { LOGISTICS_BIAS_TERMS, LOGISTICS_TEMPLATES } from "@/lib/domains/logistics"
import { PATHOLOGY_BIAS_TERMS, PATHOLOGY_TEMPLATES } from "@/lib/domains/pathology"

/** The domain registry: every schema adapter the app knows about, keyed by template code.
 *
 * Retrieval, extraction, projection, and (Stage 3) ASR all read a domain's behaviour from here
 * rather than branching on it, so supporting a new document domain means adding a pack file and
 * one line below — no changes to the pipeline.
 *
 * IMPORTANT: only the finance pack is seeded into new files (models/files.ts, via
 * DEFAULT_DOCUMENT_TEMPLATES). Pathology and logistics are registered but opt-in, so registering a
 * domain never changes what an existing or newly created file contains. */

export type DomainAdapter = {
  /** Template code — unique across all domains, and the join key to DocumentTemplate.code. */
  code: string
  name: string
  documentType: string
  /** The domain this template belongs to, for domain-scoped queries and ASR term selection. */
  domain: "finance" | "pathology" | "logistics" | "construction" | "general"
  isSystem: boolean
  multiRow: boolean
  fields: DocumentFieldDefinition[]
  /** Extra extraction instructions appended to the standard prompt; null for domains that need none. */
  prompt: string | null
  /** Vocabulary the ASR backend is biased towards for this domain (Stage 3). */
  biasTerms: readonly string[]
  /** True for domains with no fixed schema: field approvals are per-document (the document's own
   * fieldSnapshot), never a shared DocumentTemplateVersion, so one dictation never inherits another
   * unrelated dictation's discovered fields. Undefined/false for every hard-coded industry pack. */
  ephemeral?: boolean
  /** The output format (lib/dictation/formats.ts) a dictation against this template defaults to
   * when the speaker names no explicit format — the field schema's usual shape. Undefined falls
   * back to the format registry's own default ("narrative") in lib/dictation/pipeline.ts. */
  defaultFormat?: string
}

/** The packs are `as const` for their literal types; parseTemplateFields is what turns their field
 * arrays into validated DocumentFieldDefinition[] at the point of use. The cast here is the one
 * place that readonly-to-mutable widening happens, and it is safe because the packs are never
 * mutated — every consumer either reads them or re-parses them. */
function pack(
  templates: readonly { code: string; name: string; documentType: string; isSystem: boolean; multiRow: boolean; fields: readonly unknown[] }[],
  domain: DomainAdapter["domain"],
  biasTerms: readonly string[],
  prompt: string | null = null,
  ephemeral = false,
  defaultFormat?: string,
): DomainAdapter[] {
  return templates.map((template) => ({
    code: template.code, name: template.name, documentType: template.documentType, domain,
    isSystem: template.isSystem, multiRow: template.multiRow,
    fields: template.fields as DocumentFieldDefinition[],
    prompt, biasTerms, ephemeral, defaultFormat,
  }))
}

const PATHOLOGY_PROMPT = [
  "This is a clinical pathology document. Quote diagnostic statements as written — never paraphrase,",
  "summarize, or infer a diagnosis, grade, or stage that is not explicitly stated.",
  "If a value is stated but unreadable, omit it rather than guessing.",
].join(" ")

export const DOMAIN_ADAPTERS: DomainAdapter[] = [
  ...pack(FINANCE_TEMPLATES, "finance", FINANCE_BIAS_TERMS, null, false, "table"),
  ...pack(FINANCE_OPTIONAL_TEMPLATES, "finance", FINANCE_BIAS_TERMS, null, false, "table"),
  ...pack(PATHOLOGY_TEMPLATES, "pathology", PATHOLOGY_BIAS_TERMS, PATHOLOGY_PROMPT, false, "soap_note"),
  ...pack(LOGISTICS_TEMPLATES, "logistics", LOGISTICS_BIAS_TERMS, null, false, "table"),
  ...pack(CONSTRUCTION_TEMPLATES, "construction", CONSTRUCTION_BIAS_TERMS, null, false, "table"),
  ...pack(BLANK_TEMPLATES, "general", BLANK_BIAS_TERMS, null, true, "narrative"),
]

export function findDomainAdapter(code: string | null | undefined): DomainAdapter | null {
  if (!code) return null
  return DOMAIN_ADAPTERS.find((adapter) => adapter.code === code) ?? null
}

/** The domain packs a file can opt into from the templates settings page. General is excluded
 * because it is the ephemeral dictation-only pack, not something with worksheets to add to a
 * file. Finance IS offered now (WP8) — unlike pathology/logistics its "pack" is only the four
 * optional templates (bank_statement, purchase_order, remittance_advice, supplier_statement);
 * the seeded four (invoice, receipt, expense_receipt, generic) are filtered out below since every
 * file already has them. Adding a pack here is exactly what "ship the domain packs" means:
 * pathology and logistics have been fully built and registered since Stage 3/4, just never
 * reachable from the UI. */
const EXTRACTION_PACK_LABELS: Partial<Record<DomainAdapter["domain"], string>> = { finance: "Finance (optional)", pathology: "Pathology", logistics: "Logistics", construction: "Construction" }

/** Codes already seeded into every new file (models/files.ts) — excluded from every pack so the
 * picker never offers to "add" a worksheet a file already has. Only finance has any overlap. */
const SEEDED_CODES = new Set<string>(FINANCE_TEMPLATES.map((template) => template.code))

export type ExtractionDomainPack = { domain: DomainAdapter["domain"]; label: string; adapters: DomainAdapter[] }

export function extractionDomainPacks(): ExtractionDomainPack[] {
  return (Object.keys(EXTRACTION_PACK_LABELS) as DomainAdapter["domain"][]).map((domain) => ({
    domain, label: EXTRACTION_PACK_LABELS[domain]!,
    adapters: DOMAIN_ADAPTERS.filter((adapter) => adapter.domain === domain && !SEEDED_CODES.has(adapter.code)),
  }))
}

export function findExtractionDomainPack(domain: string | null | undefined): ExtractionDomainPack | null {
  return extractionDomainPacks().find((pack) => pack.domain === domain) ?? null
}

/** The template codes the dictation page offers, in the order it offers them.
 *
 * A list rather than "every adapter", because dictating a bill of lading is not a thing anyone
 * does — a domain is registered for extraction long before speech makes sense for it. Adding a
 * second dictation domain is one entry here plus its pack file; nothing else changes.
 *
 * Lives here rather than beside the actions because a "use server" module may only export async
 * functions, so a constant cannot sit in one. */
export const DICTATION_TEMPLATE_CODES = ["general_report"] as const

/** The adapters behind DICTATION_TEMPLATE_CODES, skipping any code with no registered pack so a
 * typo removes one option rather than breaking the page. */
export function dictationAdapters(): DomainAdapter[] {
  return DICTATION_TEMPLATE_CODES.map((code) => findDomainAdapter(code)).filter((adapter): adapter is DomainAdapter => adapter !== null)
}

/** ASR bias terms for a template code, falling back to the union of nothing (rather than every
 * domain's vocabulary) when the code is unknown — biasing towards the wrong domain is worse than
 * not biasing at all. */
export function biasTermsForTemplate(code: string | null | undefined): string[] {
  return [...(findDomainAdapter(code)?.biasTerms ?? [])]
}

export { BLANK_TEMPLATES, CONSTRUCTION_TEMPLATES, FINANCE_TEMPLATES, LOGISTICS_TEMPLATES, PATHOLOGY_TEMPLATES }
