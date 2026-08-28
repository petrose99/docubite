import { FINANCE_TEMPLATES, LOGISTICS_TEMPLATES, PATHOLOGY_TEMPLATES } from "@/lib/domains"
import type { Industry } from "@/types/industry"

/** "generic" (Custom document) is finance's own 4th seeded template, not a standalone pack — every
 * other industry's seed set borrows it by pulling it out of FINANCE_TEMPLATES rather than
 * duplicating its field definition. */
const GENERIC_TEMPLATE = FINANCE_TEMPLATES.find((template) => template.code === "generic")!

/** The templates a brand-new file gets, by workspace industry — what createWorkspaceForUser /
 * createTeamWorkspace (models/workspaces.ts) will pass to createFile once Part 3 wires this in,
 * replacing today's bare DEFAULT_DOCUMENT_TEMPLATES/no-param call. Not wired yet: this function
 * exists and is tested, but nothing calls it in production code until Part 3. */
export function seedTemplatesForIndustry(industry: Industry) {
  switch (industry) {
    case "finance":
      return FINANCE_TEMPLATES
    case "healthcare":
      return [...PATHOLOGY_TEMPLATES, GENERIC_TEMPLATE]
    case "logistics":
      return [...LOGISTICS_TEMPLATES, GENERIC_TEMPLATE]
    case "construction":
      // TODO(Part 3): lib/domains/construction.ts doesn't exist yet. Falls back to just the
      // generic template so a construction workspace isn't left with an empty file in the
      // meantime; swap for [...CONSTRUCTION_TEMPLATES, GENERIC_TEMPLATE] once that pack lands.
      return [GENERIC_TEMPLATE]
    case "general":
      return FINANCE_TEMPLATES.filter((template) => template.code === "invoice" || template.code === "receipt" || template.code === "generic")
  }
}
