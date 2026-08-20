/** The blank domain pack — the "general report" dictation starting point.
 *
 * No fields, no bias terms, no extraction prompt. This is the adapter for industry-agnostic
 * dictation: a document starts with nothing and the model proposes the whole field set from what
 * was actually said (discover mode, lib/field-suggestions.ts). Hard-coded industry packs
 * (pathology, and future ones) remain the fast path when a domain is known in advance; this is the
 * path for everything else.
 *
 * `ephemeral: true` marks this pack's approvals as per-document rather than shared: accepting a
 * suggested field here writes into the document's own fieldSnapshot instead of minting a new
 * DocumentTemplateVersion, so one dictation never contaminates the next with an unrelated
 * industry's fields (models/field-suggestions.ts). */
export const BLANK_TEMPLATES = [
  {
    code: "general_report", name: "General report", documentType: "general_report", isSystem: false, multiRow: false,
    fields: [],
  },
] as const

export const BLANK_BIAS_TERMS = [] as const
