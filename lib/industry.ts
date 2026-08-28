import type { Industry } from "@/types/industry"

export class IndustryError extends Error {
  constructor(readonly required: Industry) {
    super(`this feature requires industry "${required}"`)
    this.name = "IndustryError"
  }
}

/** Throws unless the workspace is in the required industry. The same fail-closed shape as
 * requireWorkspaceRole: call it in server actions and route handlers guarding an industry-specific
 * feature (dictation today; finance-only routes once WP8+ lands), so the feature can never be
 * reached by guessing a URL after the sidebar stops linking to it — see components/shell/sidebar.tsx
 * and models/workspaces.ts's setIndustry for the other half of this gate.
 * TODO: superseded by a module-based capability check once the module/capability architecture lands. */
export function assertMode(mode: Industry, required: Industry): void {
  if (mode !== required) throw new IndustryError(required)
}
