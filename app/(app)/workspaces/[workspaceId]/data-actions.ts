"use server"

import { ActionState } from "@/lib/actions"
import { aggregateFieldValues, type AggregateOp, type AggregateResult, type DataFilters } from "@/models/document-values"
import { updateDocumentField } from "@/models/documents"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

const AGGREGATE_OPS: AggregateOp[] = ["sum", "avg", "min", "max", "count"]

/** Runs one aggregate for the /data aggregates strip. The filters mirror the browser's current
 * query so the number reflects exactly the rows on screen. */
export async function aggregateValuesAction(
  workspaceId: string,
  input: { fieldKey: string; itemKey?: string | null; op: AggregateOp; groupByFieldKey?: string | null; documentFilters?: DataFilters },
): Promise<ActionState<AggregateResult>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!input.fieldKey || !AGGREGATE_OPS.includes(input.op)) return { success: false, error: "Invalid aggregate" }
  try {
    const result = await aggregateFieldValues(workspaceId, input)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not calculate") }
  }
}

/** Reverts one AI-made field edit to the value it held before, recorded as a normal audited edit.
 * The previous value travels back from the chat message's tool result, so no server session state
 * is needed. */
export async function undoAiFieldEditAction(
  workspaceId: string,
  documentId: string,
  fieldKey: string,
  previousValue: unknown,
): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await updateDocumentField({ workspaceId, documentId, fieldKey, value: previousValue ?? null, actorId: user.id })
    revalidatePath(`/workspaces/${workspaceId}/data`)
    revalidatePath(`/workspaces/${workspaceId}/documents/${documentId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not undo the change") }
  }
}
