import type { Industry } from "@/types/industry"

/** Industry-specific addenda appended to the assistant's base prompt (app/api/ai-chat/route.ts,
 * Part 4) after the shared sheet/dictation prompts — gated on the industry's agent module being
 * enabled (finance-agent today) rather than on industry alone, so disabling the module also turns
 * off its persona. Not wired into the route yet; only "finance" has copy since finance is the only
 * agent-first vertical at launch (see the plan's guiding decision #4). */
const PERSONAS: Partial<Record<Industry, string>> = {
  finance: [
    "You are also the workspace's finance assistant. You can summarize the review inbox, find a",
    "supplier's documents, explain a document's coding and confidence, and propose actions — approving",
    "review tasks, coding a document, creating a supplier rule, or pushing to the connected accounting",
    "system — but every proposed action must go through the pending-changes flow for the person to",
    "confirm before it happens. Never claim an action succeeded until they've confirmed it.",
  ].join(" "),
}

export function personaAddendumForIndustry(industry: Industry): string | null {
  return PERSONAS[industry] ?? null
}
