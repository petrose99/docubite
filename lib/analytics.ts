import { prisma } from "@/lib/db"
import { z } from "zod"

/** First-party product analytics — no third-party SDK, so nothing here ever leaves this app's own
 * database (see the ProductEvent model's comment for why). Every event name has its own `.strict()`
 * zod schema below: `.strict()` means an unexpected key — a filename, a search query, an extracted
 * value someone absent-mindedly threaded through — fails validation instead of silently riding
 * along. That is the actual enforcement of "no free text/filenames/content in analytics", not a
 * comment asking callers to remember it. */

const uuid = z.string().uuid()

const EVENT_SCHEMAS = {
  /** One per document, at the point it is accepted into the pipeline (not per file/batch). Fired
   * from lib/ingestion.ts's createIngestionItem, which is the one place that knows the real intake
   * channel — Document.source itself only ever says "upload" or "dictation" (models/documents.ts),
   * collapsing camera/zip/email/api into "upload" at the database level. */
  document_uploaded: z.object({ fileId: uuid, documentId: uuid, source: z.enum(["upload", "dictation", "camera", "zip", "email", "api"]) }).strict(),
  /** Written once extraction finishes, success or failure — the pair this + document_uploaded
   * gives is time-to-first-extraction. */
  document_extraction_completed: z.object({ documentId: uuid, templateCode: z.string().max(80), status: z.enum(["success", "failed"]), durationMs: z.number().int().nonnegative() }).strict(),
  /** A save, not a diff: how many fields changed, never what they changed to or from. */
  document_correction_saved: z.object({ documentId: uuid, fieldCount: z.number().int().nonnegative() }).strict(),
  document_exported: z.object({ fileId: uuid, format: z.enum(["csv", "xlsx"]) }).strict(),
  /** A reviewer edited an automation rule (WP11) — the "update rule" correction flow. Never fires
   * for the document the correction was noticed on; only the rule id, since the point of this
   * metric is "how often do rules need fixing", not which document triggered any one fix. */
  automation_rule_corrected: z.object({ ruleId: uuid }).strict(),
  /** A deterministic check (WP12) came back warn or fail. checkCode/status only — never the
   * numbers involved, which could reconstruct a customer's actual financial data from the event
   * stream alone. */
  document_check_failed: z.object({ documentId: uuid, checkCode: z.string().max(80), status: z.enum(["warn", "fail"]) }).strict(),
} as const

export type AnalyticsEventName = keyof typeof EVENT_SCHEMAS
export type AnalyticsEventProps<N extends AnalyticsEventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>

/** Records one product event. Never throws — an analytics write must not be able to break the
 * action it is instrumenting, the same reasoning as lib/audit.ts's write(). Invalid props (an
 * unknown key, a wrong type) are dropped with a console.error rather than silently coerced: a
 * schema mismatch here is a bug in the calling code, worth being loud about in logs without ever
 * being loud enough to fail the request. */
export async function track<N extends AnalyticsEventName>(
  name: N,
  props: AnalyticsEventProps<N>,
  context: { workspaceId?: string | null; actorId?: string | null } = {},
): Promise<void> {
  const parsed = EVENT_SCHEMAS[name].safeParse(props)
  if (!parsed.success) {
    console.error(`[analytics] dropped ${name}: ${parsed.error.message}`)
    return
  }
  try {
    await prisma.productEvent.create({ data: { workspaceId: context.workspaceId ?? null, actorId: context.actorId ?? null, name, props: parsed.data } })
  } catch (error) {
    console.error(`[analytics] failed to record ${name}:`, error instanceof Error ? error.message : error)
  }
}

/** How long ProductEvent rows are kept before the worker's retention sweep (lib/analytics.ts's
 * sweepOldEvents) deletes them. Aggregate rollups only ever look at the trailing 7 days, so 90
 * days is headroom for a slow month-over-month comparison, not a promise of longer retention. */
export const PRODUCT_EVENT_RETENTION_DAYS = 90

export async function sweepOldProductEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PRODUCT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const result = await prisma.productEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}
