import { FINANCE_TEMPLATES } from "@/lib/domains"
import type { Industry } from "@/types/industry"

/** The templates a brand-new file gets, by workspace industry — passed to createFile from
 * createWorkspaceForUser / createTeamWorkspace (models/workspaces.ts), replacing the old bare
 * DEFAULT_DOCUMENT_TEMPLATES/no-param call. The app is finance-only, so every workspace gets the
 * same seed set. */
export function seedTemplatesForIndustry(industry: Industry) {
  return FINANCE_TEMPLATES
}
