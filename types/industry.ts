/** The industries a workspace can be (see prisma/schema.prisma's Workspace.industry). The app is
 * finance-only now — "finance" is the deep vertical (mirrors Dext) and the only supported value. */
export const INDUSTRIES = ["finance"] as const
export type Industry = (typeof INDUSTRIES)[number]

export function parseIndustry(value: unknown): Industry | null {
  return value === "finance" ? "finance" : null
}
