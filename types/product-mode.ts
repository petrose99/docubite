/** The two positionings the app ships under (see prisma/schema.prisma's Workspace.productMode).
 * "accounting" is the default and the primary buyer going forward; "clinical" is the original
 * dictation-first positioning, which HIPAA mode presumes. */
export const PRODUCT_MODES = ["accounting", "clinical"] as const
export type ProductMode = (typeof PRODUCT_MODES)[number]

export function parseProductMode(value: unknown): ProductMode | null {
  return value === "accounting" || value === "clinical" ? value : null
}
