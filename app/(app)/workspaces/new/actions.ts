"use server"

import { ActionState } from "@/lib/actions"
import { getViewerUser } from "@/lib/auth"
import { createWorkspaceForUser, getWorkspacesForUser } from "@/models/workspaces"
import { parseIndustry } from "@/types/industry"

/** Creates the brand-new user's first (personal) workspace with the industry they picked on
 * /workspaces/new, instead of the old silent "general" default from getOrCreateWorkspaceForUser's
 * lazy-creation path. */
export async function createInitialWorkspaceAction(name: string, industry: string): Promise<ActionState<{ workspaceId: string }>> {
  const user = await getViewerUser()
  if (!user) return { success: false, error: "Not signed in" }
  const parsed = parseIndustry(industry)
  if (!parsed) return { success: false, error: "Choose an industry" }
  // A double-submit or a back-button revisit after the redirect already fired: send them to the
  // workspace that now exists rather than minting a second one.
  const existing = await getWorkspacesForUser(user.id)
  if (existing.length) return { success: true, data: { workspaceId: existing[0].id } }
  try {
    const workspace = await createWorkspaceForUser(user, { name: name.trim() || undefined, industry: parsed })
    return { success: true, data: { workspaceId: workspace.id } }
  } catch {
    return { success: false, error: "Could not set up your workspace" }
  }
}
