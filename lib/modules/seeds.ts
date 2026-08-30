import { CONSTRUCTION_TEMPLATES, FINANCE_TEMPLATES, LOGISTICS_TEMPLATES, PATHOLOGY_TEMPLATES } from "@/lib/domains"
import type { Industry } from "@/types/industry"

/** "generic" (Custom document) is finance's own 4th seeded template, not a standalone pack — every
 * other industry's seed set borrows it by pulling it out of FINANCE_TEMPLATES rather than
 * duplicating its field definition. */
const GENERIC_TEMPLATE = FINANCE_TEMPLATES.find((template) => template.code === "generic")!

/** The templates a brand-new file gets, by workspace industry — passed to createFile from
 * createWorkspaceForUser / createTeamWorkspace (models/workspaces.ts), replacing the old bare
 * DEFAULT_DOCUMENT_TEMPLATES/no-param call. */
export function seedTemplatesForIndustry(industry: Industry) {
  switch (industry) {
    case "finance":
      return FINANCE_TEMPLATES
    case "healthcare":
      return [...PATHOLOGY_TEMPLATES, GENERIC_TEMPLATE]
    case "logistics":
      return [...LOGISTICS_TEMPLATES, GENERIC_TEMPLATE]
    case "construction":
      return [...CONSTRUCTION_TEMPLATES, GENERIC_TEMPLATE]
    case "general":
      return FINANCE_TEMPLATES.filter((template) => template.code === "invoice" || template.code === "receipt" || template.code === "generic")
    case "spreadsheets":
      return [GENERIC_TEMPLATE]
  }
}
