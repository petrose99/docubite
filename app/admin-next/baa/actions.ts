"use server"

import { isAdmin } from "@/lib/admin"
import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

/** Confirms (or revokes) BAA coverage for a workspace's external ASR provider — the one setting
 * next-admin's generated CRUD deliberately cannot make (see next-admin-options.ts's header on why
 * invariant-carrying fields are excluded there): this one needs an AdminAuditEvent, which a raw
 * field edit would never write. requireAdminActor's page-guard equivalent, inlined here rather
 * than imported, since a "use server" action is not a page — the check has to run per call. */
export async function setAsrExternalAllowedAction(workspaceId: string, allowed: boolean): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!isAdmin(user)) return { success: false, error: "Not authorized" }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { asrExternalAllowed: true } })
  if (!workspace) return { success: false, error: "Workspace not found" }
  if (workspace.asrExternalAllowed === allowed) return { success: true, data: null }

  await prisma.$transaction([
    prisma.workspace.update({ where: { id: workspaceId }, data: { asrExternalAllowed: allowed } }),
    prisma.adminAuditEvent.create({
      data: {
        actorId: user.id,
        targetWorkspaceId: workspaceId,
        type: allowed ? "asr_external_allowed_enabled" : "asr_external_allowed_disabled",
      },
    }),
  ])

  revalidatePath("/admin-next/baa")
  return { success: true, data: null }
}
