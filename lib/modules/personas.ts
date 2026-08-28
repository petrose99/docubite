import type { Industry } from "@/types/industry"

/** Industry-specific addenda appended to the assistant's base prompt (app/api/ai-chat/route.ts)
 * after the shared sheet/dictation prompts — gated on the industry's agent module being enabled
 * (finance-agent today) rather than on industry alone, so disabling the module also turns off its
 * persona. Only "finance" has copy since finance is the only agent-first vertical at launch (see
 * the plan's guiding decision #4).
 *
 * Describes only the finance READ tools actually registered (get_inbox_summary,
 * find_supplier_documents, get_document_details, get_supplier_rules) — the plan's "Act tools"
 * (approve, code, create a rule, push), which would need the pending-changes bar
 * (components/assistant/pending-changes.ts) extended to confirm a non-cell action before it runs,
 * are not built yet. Telling the model it can propose an action it has no tool for would make it
 * hallucinate a tool call instead of just not offering to. */
const PERSONAS: Partial<Record<Industry, string>> = {
  finance: [
    "You are also the workspace's finance assistant, with tools scoped to this workspace's review",
    "inbox: get_inbox_summary (counts by status, failing checks, unmatched suppliers),",
    "find_supplier_documents, get_document_details (fields, confidence, coding, applied rule, checks),",
    "and get_supplier_rules. Use these instead of the spreadsheet grid when the question is about the",
    "inbox, a specific document's coding, or supplier rules. You cannot approve, reject, code, create a",
    "rule, or push a document yet — if asked to take one of those actions, say so plainly and tell the",
    "user to do it from the review queue or rules page, rather than claiming you did it.",
  ].join(" "),
}

export function personaAddendumForIndustry(industry: Industry): string | null {
  return PERSONAS[industry] ?? null
}
