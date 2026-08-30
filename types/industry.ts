/** The industries a workspace can be (see prisma/schema.prisma's Workspace.industry). "finance" is
 * the deep vertical (mirrors Dext); "healthcare" is the original dictation-first positioning, which
 * HIPAA mode presumes; "construction" and "logistics" are newer verticals; "general" is the shared
 * baseline every industry gets, with no vertical-specific modules enabled; "spreadsheets" is the
 * same core-only baseline as "general" but seeds a single generic worksheet instead of the
 * invoice/receipt/generic set — see lib/modules/seeds.ts. */
export const INDUSTRIES = ["finance", "healthcare", "construction", "logistics", "general", "spreadsheets"] as const
export type Industry = (typeof INDUSTRIES)[number]

export function parseIndustry(value: unknown): Industry | null {
  return typeof value === "string" && (INDUSTRIES as readonly string[]).includes(value) ? (value as Industry) : null
}
