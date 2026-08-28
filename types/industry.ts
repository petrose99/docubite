/** The industries a workspace can be (see prisma/schema.prisma's Workspace.industry). "finance" is
 * the deep vertical (mirrors Dext); "healthcare" is the original dictation-first positioning, which
 * HIPAA mode presumes; "construction" and "logistics" are newer verticals; "general" is the shared
 * baseline every industry gets, with no vertical-specific modules enabled. */
export const INDUSTRIES = ["finance", "healthcare", "construction", "logistics", "general"] as const
export type Industry = (typeof INDUSTRIES)[number]

export function parseIndustry(value: unknown): Industry | null {
  return typeof value === "string" && (INDUSTRIES as readonly string[]).includes(value) ? (value as Industry) : null
}
