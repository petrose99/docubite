import type { ProductMode } from "@/types/product-mode"

export class ProductModeError extends Error {
  constructor(readonly required: ProductMode) {
    super(`this feature requires product mode "${required}"`)
    this.name = "ProductModeError"
  }
}

/** Throws unless the workspace is in the required product mode. The same fail-closed shape as
 * requireWorkspaceRole: call it in server actions and route handlers guarding a mode-specific
 * feature (dictation today; accounting-only routes once WP8+ lands), so the feature can never be
 * reached by guessing a URL after the sidebar stops linking to it — see components/shell/sidebar.tsx
 * and models/workspaces.ts's setProductMode for the other half of this gate. */
export function assertMode(mode: ProductMode, required: ProductMode): void {
  if (mode !== required) throw new ProductModeError(required)
}
