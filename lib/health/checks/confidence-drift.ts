/** Flags a template whose extraction confidence has quietly gotten worse: the rolling 30-day mean
 * `document_field_values.source_confidence`, grouped by `template_code`, compared against the
 * prior 30 days. A drop of more than 5 percentage points is flagged.
 *
 * Same convention as lib/analytics/workspace-analytics.ts: the aggregate read is a pure
 * `build*Sql(): Sql` function (parameterised text + bind values), unit-tested without a database.
 * models/health.ts runs the query and hands the resulting rows in via CheckContext.confidenceDrift
 * — this file's `run` never touches Prisma. */
import type { CheckDefinition, CheckRunResult, ConfidenceDriftRow } from "@/lib/health/types"

export type Sql = { text: string; params: unknown[] }

export const CONFIDENCE_DRIFT_THRESHOLD_POINTS = 5 // percentage points, i.e. 0.05 on a 0-1 scale

/** `to` is the run's reference "now" (ctx.dateRange.to) — the window is always the trailing 60
 * days ending there: [to-60d, to-30d) is "prior", [to-30d, to] is "current". */
export function buildConfidenceDriftSql(workspaceId: string, to: Date): Sql {
  const currentStart = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  const priorStart = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000)
  const params: unknown[] = [workspaceId, currentStart, to, priorStart]
  return {
    text: `WITH current_period AS (
        SELECT "template_code", AVG("source_confidence") AS mean, COUNT(*)::int AS count
        FROM "document_field_values"
        WHERE "workspace_id" = $1::uuid AND "source_confidence" IS NOT NULL AND "template_code" IS NOT NULL
          AND "created_at" >= $2 AND "created_at" <= $3
        GROUP BY "template_code"
      ),
      prior_period AS (
        SELECT "template_code", AVG("source_confidence") AS mean, COUNT(*)::int AS count
        FROM "document_field_values"
        WHERE "workspace_id" = $1::uuid AND "source_confidence" IS NOT NULL AND "template_code" IS NOT NULL
          AND "created_at" >= $4 AND "created_at" < $2
        GROUP BY "template_code"
      ),
      representative AS (
        SELECT DISTINCT ON ("template_code") "template_code", "document_id"
        FROM "document_field_values"
        WHERE "workspace_id" = $1::uuid AND "template_code" IS NOT NULL
          AND "created_at" >= $2 AND "created_at" <= $3
        ORDER BY "template_code", "created_at" DESC
      )
      SELECT c."template_code" AS "templateCode",
        c.mean AS "currentMean", c.count AS "currentCount",
        p.mean AS "priorMean", COALESCE(p.count, 0) AS "priorCount",
        r."document_id" AS "representativeDocumentId"
      FROM current_period c
      LEFT JOIN prior_period p ON p."template_code" = c."template_code"
      LEFT JOIN representative r ON r."template_code" = c."template_code"`,
    params,
  }
}

export const confidenceDriftCheck: CheckDefinition = {
  code: "confidence_drift",
  name: "Extraction confidence drift",
  category: "pipeline",
  defaultWeight: 1,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    // Only a template with a real prior-period baseline is "applicable" — a template with no
    // history to compare against has nothing to drift from yet.
    const withBaseline = ctx.confidenceDrift.filter((row) => row.priorCount > 0 && row.currentCount > 0)
    const applicableCount = withBaseline.length

    const dropped = withBaseline.filter((row) => row.priorMean - row.currentMean > CONFIDENCE_DRIFT_THRESHOLD_POINTS / 100)

    const findings = dropped.map((row: ConfidenceDriftRow) => ({
      checkCode: "confidence_drift",
      category: "pipeline" as const,
      severity: "warning" as const,
      title: `Extraction confidence dropped for "${row.templateCode}"`,
      description: `Average confidence on ${row.templateCode} fell from ${(row.priorMean * 100).toFixed(0)}% to ${(row.currentMean * 100).toFixed(0)}% over the last 30 days.`,
      documentId: row.representativeDocumentId,
      suggestedAction: "review_template",
      suggestedActionPayload: { templateCode: row.templateCode, priorMean: row.priorMean, currentMean: row.currentMean },
      affectedCount: row.currentCount,
    }))

    return { findings, applicableCount }
  },
}
