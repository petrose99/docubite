// Deliberately NOT a "use server" module — same reasoning as models/workspaces.ts: this trusts its
// caller-supplied workspaceId/actor, so the auth (owner-only for enable/disable, any member for
// request) and revalidatePath belong in the server action that calls it, not here.
import { prisma } from "@/lib/db"
import { findModule } from "@/lib/modules"
import type { ModuleOverride } from "@/lib/modules/capabilities"

/** Upserts the workspace's override row for a module. Always/default modules can be "disabled";
 * optional modules can be "enabled" or "requested" — resolveModules is what actually interprets
 * these, this just records the caller's intent. Unknown module keys are refused so a typo in a
 * server action can't silently create a dead row nothing ever reads. */
export async function setModuleState(input: { workspaceId: string; moduleKey: string; status: ModuleOverride; actorId: string; source?: "user" | "admin"; note?: string }) {
  if (!findModule(input.moduleKey)) throw new Error("unknown_module")
  return prisma.workspaceModule.upsert({
    where: { workspaceId_moduleKey: { workspaceId: input.workspaceId, moduleKey: input.moduleKey } },
    create: { workspaceId: input.workspaceId, moduleKey: input.moduleKey, status: input.status, source: input.source || "user", requestedById: input.status === "requested" ? input.actorId : null, note: input.note },
    update: { status: input.status, source: input.source || "user", requestedById: input.status === "requested" ? input.actorId : null, note: input.note },
  })
}

/** Includes the requester's name/email so the catalog page can badge a "requested" row with who
 * asked and when, without a second query per row. */
export const getWorkspaceModuleOverrides = (workspaceId: string) => prisma.workspaceModule.findMany({
  where: { workspaceId },
  include: { requestedBy: { select: { name: true, email: true } } },
  orderBy: { createdAt: "asc" },
})
