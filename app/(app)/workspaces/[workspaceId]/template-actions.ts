"use server"

import { ActionState } from "@/lib/actions"
import {
  createWorkspaceTemplate,
  deleteWorkspaceTemplate,
  listWorkspaceTemplates,
  touchWorkspaceTemplateUse,
  updateWorkspaceTemplate,
  type WorkspaceTemplateInput,
} from "@/models/workspace-templates"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

export type LibraryTemplate = {
  id: string
  name: string
  description: string | null
  docType: string | null
  fields: unknown
  prompt: string | null
  multiRow: boolean
  useCount: number
}

const templatesPath = (workspaceId: string) => `/workspaces/${workspaceId}/settings/templates`

const toLibraryTemplate = (template: Awaited<ReturnType<typeof listWorkspaceTemplates>>[number]): LibraryTemplate => ({
  id: template.id,
  name: template.name,
  description: template.description,
  docType: template.docType,
  fields: template.fields,
  prompt: template.prompt,
  multiRow: template.multiRow,
  useCount: template.useCount,
})

/** Any member may contribute a template to the library (it is saved from the extract panel they
 * already use); editing and deleting library entries is owner-gated. */
export async function saveTemplateToLibraryAction(workspaceId: string, input: WorkspaceTemplateInput): Promise<ActionState<LibraryTemplate>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const template = await createWorkspaceTemplate(workspaceId, user.id, input)
    revalidatePath(templatesPath(workspaceId))
    return { success: true, data: toLibraryTemplate(template) }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not save the template") }
  }
}

export async function listLibraryTemplatesAction(workspaceId: string): Promise<ActionState<LibraryTemplate[]>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const templates = await listWorkspaceTemplates(workspaceId)
    return { success: true, data: templates.map(toLibraryTemplate) }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not load templates") }
  }
}

export async function updateLibraryTemplateAction(workspaceId: string, id: string, input: WorkspaceTemplateInput): Promise<ActionState<LibraryTemplate>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const template = await updateWorkspaceTemplate(workspaceId, id, input)
    revalidatePath(templatesPath(workspaceId))
    return { success: true, data: toLibraryTemplate(template) }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not update the template") }
  }
}

export async function deleteLibraryTemplateAction(workspaceId: string, id: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await deleteWorkspaceTemplate(workspaceId, id)
    revalidatePath(templatesPath(workspaceId))
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not delete the template") }
  }
}

/** Fire-and-forget usage bump when a library entry is applied to a file. */
export async function markLibraryTemplateUsedAction(workspaceId: string, id: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  await touchWorkspaceTemplateUse(workspaceId, id)
  return { success: true, data: null }
}
