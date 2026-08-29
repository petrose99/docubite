// Deliberately NOT a "use server" module, matching every other models/*.ts helper: called
// fire-and-forget from models/documents.ts after a review commit, and read from
// lib/document-processing.ts before the next extraction prompt is built.
import { prisma } from "@/lib/db"
import { cache } from "react"

/** Per (workspace, template, field), only this many distinct corrections are kept — the oldest by
 * updatedAt is evicted to make room, so a workspace with a churny field doesn't grow this table
 * without bound. */
const MAX_CORRECTIONS_PER_FIELD = 20

/** Records that `wrongValue` was corrected to `correctedValue` for one (workspace, template,
 * field) — or, if that exact pair was already recorded, just bumps its hitCount. Fire-and-forget
 * from the caller: never throws (the caller wraps it, but this stays defensive on its own too),
 * since a missed correction is a lost learning signal, not a broken review. */
export async function recordFieldCorrection(input: {
  workspaceId: string
  templateCode: string
  fieldKey: string
  supplier: string | null
  wrongValue: string
  correctedValue: string
}): Promise<void> {
  try {
    await prisma.fieldCorrection.upsert({
      where: { workspaceId_templateCode_fieldKey_wrongValue_correctedValue: { workspaceId: input.workspaceId, templateCode: input.templateCode, fieldKey: input.fieldKey, wrongValue: input.wrongValue, correctedValue: input.correctedValue } },
      create: { workspaceId: input.workspaceId, templateCode: input.templateCode, fieldKey: input.fieldKey, supplier: input.supplier, wrongValue: input.wrongValue, correctedValue: input.correctedValue },
      update: { hitCount: { increment: 1 }, supplier: input.supplier ?? undefined },
    })

    const rows = await prisma.fieldCorrection.findMany({
      where: { workspaceId: input.workspaceId, templateCode: input.templateCode, fieldKey: input.fieldKey },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    })
    const excess = rows.slice(MAX_CORRECTIONS_PER_FIELD)
    if (excess.length) await prisma.fieldCorrection.deleteMany({ where: { id: { in: excess.map((row) => row.id) } } })
  } catch (error) {
    console.error("[field-corrections] failed to record correction:", error instanceof Error ? error.message : error)
  }
}

export type FewShotExample = { fieldKey: string; wrongValue: string; correctedValue: string }

/** The strongest few-shot examples for one (workspace, template) — highest hitCount first, most
 * recently reinforced as the tiebreak. Values are truncated to keep the prompt bounded even if a
 * corrected value was pasted in unusually long. */
export const getFewShotExamples = cache(async (workspaceId: string, templateCode: string, limit = 8): Promise<FewShotExample[]> => {
  const rows = await prisma.fieldCorrection.findMany({
    where: { workspaceId, templateCode },
    orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: { fieldKey: true, wrongValue: true, correctedValue: true },
  })
  return rows.map((row) => ({ fieldKey: row.fieldKey, wrongValue: truncate(row.wrongValue), correctedValue: truncate(row.correctedValue) }))
})

function truncate(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value
}
