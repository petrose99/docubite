import { prisma } from "@/lib/db"

/** The six headline metrics for the admin console's analytics page, over a trailing window.
 * Deliberately raw SQL, not Prisma's query builder: a median and a JSONB field pull aren't
 * expressible in it, and every other rollup here is cheap enough to write the same way rather
 * than mixing two query styles for no reason. */
export type AnalyticsRollup = {
  weeklyActiveWorkspaces: number
  documentsUploaded: number
  extractionsCompleted: number
  extractionSuccessRate: number | null
  medianTimeToFirstExtractionMs: number | null
  correctionsSaved: number
  exportsCount: number
}

export async function getAnalyticsRollup(windowDays = 7): Promise<AnalyticsRollup> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const [activeWorkspaces, uploaded, extractions, corrections, exportsRow] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT workspace_id) AS count FROM product_events
      WHERE created_at >= ${since} AND workspace_id IS NOT NULL
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM product_events WHERE created_at >= ${since} AND name = 'document_uploaded'
    `,
    prisma.$queryRaw<{ total: bigint; succeeded: bigint; median_duration_ms: number | null }[]>`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE props->>'status' = 'success') AS succeeded,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'durationMs')::numeric)
          FILTER (WHERE props->>'status' = 'success') AS median_duration_ms
      FROM product_events WHERE created_at >= ${since} AND name = 'document_extraction_completed'
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM product_events WHERE created_at >= ${since} AND name = 'document_correction_saved'
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM product_events WHERE created_at >= ${since} AND name = 'document_exported'
    `,
  ])

  const extractionRow = extractions[0]
  const totalExtractions = Number(extractionRow?.total ?? 0)
  const succeededExtractions = Number(extractionRow?.succeeded ?? 0)

  return {
    weeklyActiveWorkspaces: Number(activeWorkspaces[0]?.count ?? 0),
    documentsUploaded: Number(uploaded[0]?.count ?? 0),
    extractionsCompleted: totalExtractions,
    extractionSuccessRate: totalExtractions > 0 ? succeededExtractions / totalExtractions : null,
    medianTimeToFirstExtractionMs: extractionRow?.median_duration_ms != null ? Number(extractionRow.median_duration_ms) : null,
    correctionsSaved: Number(corrections[0]?.count ?? 0),
    exportsCount: Number(exportsRow[0]?.count ?? 0),
  }
}
