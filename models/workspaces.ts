// Deliberately NOT a "use server" module: these are internal data-access helpers that trust
// their caller-supplied arguments (acceptWorkspaceInvitation takes the user to attach). The
// directive would publish every export as a callable endpoint, letting a client pass a forged
// user. Server actions live in app/(app)/workspaces/[workspaceId]/actions.ts and do the auth.
import { auditEventData, getRequestAuditContext, recordDocumentAudit } from "@/lib/audit"
import { recordAdminAudit } from "@/lib/auth-audit"
import { archiveWorkspaceAuditEvents } from "@/lib/audit-archive"
import { deleteDocumentSource } from "@/lib/document-storage"
import { prisma } from "@/lib/db"
import config from "@/lib/config"
import { deleteFiles } from "@/models/files"
import { enqueueBigcapitalProvisionJob } from "@/models/bigcapital"
import { User } from "@/prisma/client"
import crypto, { randomBytes } from "crypto"
import { cache } from "react"

export type WorkspaceRole = "owner" | "member"
/** "personal" is the implicit one-member workspace every user gets; "team" is the shared kind
 * any member may create — there is no plan gate on this anymore. */
export type WorkspaceKind = "personal" | "team"

const invitationHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

const parseRole = (value: unknown): WorkspaceRole => (value === "owner" ? "owner" : "member")

/** Every invariant a mutation depends on has to be read through this, never through
 * getWorkspaceMembership/getWorkspacesForUser/getWorkspaceMembers: those are React-`cache`d, so
 * within one request they would hand back the snapshot from *before* the mutation that is
 * currently running and happily wave through demoting or removing the last owner. */
const countOwners = (workspaceId: string) => prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } })

export async function createWorkspaceForUser(user: Pick<User, "id" | "name" | "email">, options: { name?: string; kind?: WorkspaceKind } = {}) {
  const workspace = await prisma.workspace.create({
    data: {
      name: options.name?.trim() || `${user.name || user.email}'s workspace`,
      kind: options.kind || "personal",
      industry: "finance",
      members: { create: { userId: user.id, role: "owner" } },
    },
  })
  // Enqueued, never awaited into the request: provisioning the Bigcapital org is several external
  // API calls (see models/bigcapital.ts) and must not add that latency to signup/workspace creation.
  // Best-effort — a failure to enqueue just means no job exists yet; the Accounting tab's repair
  // action (P2) re-enqueues on demand.
  if (config.integrations.bigcapital.enabled) {
    await enqueueBigcapitalProvisionJob(workspace.id, user.id).catch((error) => {
      console.error("[workspaces] failed to enqueue bigcapital provisioning:", error instanceof Error ? error.message : error)
    })
  }
  await recordDocumentAudit({ workspaceId: workspace.id, actorId: user.id, type: "workspace_created", detail: { kind: workspace.kind, name: workspace.name } })
  return workspace
}

/** Lido's Workspace nav item: a shared team. There is no plan gate on creating one anymore. */
export async function createTeamWorkspace(user: Pick<User, "id" | "name" | "email" | "role">, name: string) {
  return createWorkspaceForUser(user, { name, kind: "team" })
}

export const getWorkspacesForUser = cache(async (userId: string) => prisma.workspace.findMany({
  where: { members: { some: { userId } } },
  include: { members: { where: { userId }, select: { role: true } } },
  orderBy: { createdAt: "asc" },
}))

export async function getOrCreateWorkspaceForUser(user: Pick<User, "id" | "name" | "email">) {
  const memberships = await getWorkspacesForUser(user.id)
  return memberships[0] || createWorkspaceForUser(user)
}

export const getWorkspaceMembership = cache(async (workspaceId: string, userId: string) => prisma.workspaceMember.findUnique({
  where: { workspaceId_userId: { workspaceId, userId } },
  include: { workspace: true },
}))

export async function requireWorkspaceRole(workspaceId: string, userId: string, allowed: WorkspaceRole[] = ["owner", "member"]) {
  const membership = await getWorkspaceMembership(workspaceId, userId)
  if (!membership || !allowed.includes(membership.role as WorkspaceRole)) throw new Error("workspace_access_denied")
  return membership
}

export const getWorkspaceMembers = cache(async (workspaceId: string) => prisma.workspaceMember.findMany({
  where: { workspaceId },
  include: { user: { select: { id: true, name: true, email: true } } },
  orderBy: [{ role: "asc" }, { createdAt: "asc" }],
}))

/** There is no plan/quota system anymore — every workspace is unlimited. This stub keeps the
 * upload flow's usage meter (components/extract/extract-panel.tsx) working without threading a
 * removal through every caller in one pass; `documentsLimit`/`aiLimit` of -1 renders as
 * "N used" rather than "N of limit". */
export async function getWorkspaceUsage(_workspaceId: string) {
  return { planName: "Unlimited", documentsUsed: 0, documentsLimit: -1, aiUsed: 0, aiLimit: -1 }
}

/* ---------------------------------------------------------------- workspace lifecycle --- */

export async function renameWorkspace(workspaceId: string, name: string, actorId: string) {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 80) throw new Error("invalid_workspace_name")
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: { name: trimmed } })
  await recordDocumentAudit({ workspaceId, actorId, type: "workspace_renamed", detail: { name: trimmed } })
  return workspace
}

/** Deliberately does NOT re-check any seat limit: there is none anymore, and this exists purely
 * so the owner can reorganise roles. */
export async function updateWorkspaceMemberRole(input: { workspaceId: string; actorId: string; memberUserId: string; role: WorkspaceRole }) {
  const role = parseRole(input.role)
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.memberUserId } } })
  if (!member) throw new Error("member_not_found")
  if (member.role === "owner" && role !== "owner" && (await countOwners(input.workspaceId)) <= 1) throw new Error("last_owner_required")
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.workspaceMember.update({ where: { id: member.id }, data: { role } }),
    prisma.documentAuditEvent.create({
      data: auditEventData(
        { workspaceId: input.workspaceId, actorId: input.actorId, type: "workspace_member_role_changed", detail: { targetUserId: input.memberUserId, from: member.role, to: role } },
        context
      ),
    }),
  ])
  return updated
}

/** Removing someone also drops the per-email file shares they hold in this workspace.
 * getFileAccess resolves DocumentFileShare independently of membership, so a removed member who
 * had ever been added to a Share dialog would otherwise keep edit access to those files. */
async function detachMember(workspaceId: string, memberId: string, email: string, actorId: string | null, type: string) {
  const normalized = email.toLowerCase()
  const context = await getRequestAuditContext()
  await prisma.$transaction([
    prisma.workspaceMember.delete({ where: { id: memberId } }),
    prisma.documentFileShare.deleteMany({ where: { email: normalized, file: { workspaceId } } }),
    prisma.workspaceInvitation.deleteMany({ where: { workspaceId, email: normalized, acceptedAt: null } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId, actorId, type }, context) }),
  ])
}

export async function removeWorkspaceMember(input: { workspaceId: string; actorId: string; memberUserId: string }) {
  if (input.actorId === input.memberUserId) throw new Error("use_leave_workspace")
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.memberUserId } },
    include: { user: { select: { email: true } } },
  })
  if (!member) throw new Error("member_not_found")
  if (member.role === "owner" && (await countOwners(input.workspaceId)) <= 1) throw new Error("last_owner_required")
  await detachMember(input.workspaceId, member.id, member.user.email, input.actorId, "workspace_member_removed")
}

/** Leaving a personal workspace is refused rather than handled: it is the user's own default
 * space, and getOrCreateWorkspaceForUser would simply mint a replacement on their next visit. */
export async function leaveWorkspace(workspaceId: string, userId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { user: { select: { email: true } }, workspace: { select: { kind: true } } },
  })
  if (!member) throw new Error("member_not_found")
  if (member.workspace.kind === "personal") throw new Error("cannot_leave_personal_workspace")
  if (member.role === "owner" && (await countOwners(workspaceId)) <= 1) {
    const members = await prisma.workspaceMember.count({ where: { workspaceId } })
    throw new Error(members > 1 ? "transfer_ownership_before_leaving" : "delete_workspace_instead")
  }
  await detachMember(workspaceId, member.id, member.user.email, userId, "workspace_member_left")
}

export async function transferWorkspaceOwnership(input: { workspaceId: string; actorId: string; targetUserId: string; stepDown?: boolean }) {
  if (input.actorId === input.targetUserId) throw new Error("cannot_transfer_to_self")
  const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } } })
  if (!target) throw new Error("member_not_found")
  const stepDown = input.stepDown !== false
  const context = await getRequestAuditContext()
  await prisma.$transaction([
    prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } }, data: { role: "owner" } }),
    ...(stepDown ? [prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.actorId } }, data: { role: "member" } })] : []),
    prisma.documentAuditEvent.create({
      data: auditEventData(
        { workspaceId: input.workspaceId, actorId: input.actorId, type: "workspace_ownership_transferred", detail: { targetUserId: input.targetUserId, stepDown } },
        context
      ),
    }),
  ])
}

/** The cascade on Workspace drops every child row, but nothing in the database knows about the
 * blob store — so the source objects have to be swept first or every upload this workspace ever
 * made is orphaned under data/document-sources (or the S3 bucket) forever.
 *
 * deleteFiles truncates its id list to 100, so this pages rather than passing every id at once;
 * a single call would silently leave the 101st file's blobs behind. There is no directory-level
 * delete in lib/document-storage.ts, so per-object is the only correct approach. */
export async function deleteWorkspace(input: { workspaceId: string; actorId: string }) {
  const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true, kind: true } })
  // Written first, to AdminAuditEvent rather than DocumentAuditEvent: the workspace cascade below
  // would destroy a DocumentAuditEvent row, and this record — "who deleted which workspace" — must
  // survive the workspace it describes.
  await recordAdminAudit({ actorId: input.actorId, type: "workspace_deleted", targetWorkspaceId: input.workspaceId, detail: { name: workspace?.name, kind: workspace?.kind } })

  for (;;) {
    const batch = await prisma.documentFile.findMany({ where: { workspaceId: input.workspaceId }, select: { id: true }, take: 100 })
    if (!batch.length) break
    const result = await deleteFiles(input.workspaceId, batch.map((file) => file.id), input.actorId)
    // Nothing deleted means the next page would be identical; stop rather than spin forever.
    if (!result.deleted) throw new Error("workspace_files_not_deletable")
  }

  // Document.fileId is non-nullable, so the sweep above should have reached every blob. Assert
  // it rather than trust it: a straggler here is a permanently orphaned object.
  const strays = await prisma.document.findMany({ where: { workspaceId: input.workspaceId }, select: { storageKey: true } })
  for (const stray of strays) if (stray.storageKey) await deleteDocumentSource(stray.storageKey).catch(() => {})

  // The workspace -> DocumentAuditEvent relation is onDelete: Restrict (HIPAA §164.316(b) requires
  // 6-year retention, so deleting a workspace must not be a way to destroy the evidence of what
  // happened inside it). Archiving to cold storage first, then clearing the rows, is what makes
  // the delete below succeed while keeping the record.
  await archiveWorkspaceAuditEvents(input.workspaceId)

  await prisma.workspace.delete({ where: { id: input.workspaceId } })
}

/** Returns the workspace name alongside the token so the caller can compose the invitation
 * email without a second query for something it just read. There is no seat limit anymore. */
export async function createWorkspaceInvitation(input: { workspaceId: string; ownerId: string; email: string; role?: WorkspaceRole }) {
  await requireWorkspaceRole(input.workspaceId, input.ownerId, ["owner"])
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId } })
  const email = input.email.trim().toLowerCase()
  const owner = await prisma.user.findUnique({ where: { id: input.ownerId }, select: { email: true } })
  if (owner && owner.email.toLowerCase() === email) throw new Error("self_invite")
  if (await prisma.workspaceMember.findFirst({ where: { workspaceId: input.workspaceId, user: { email } } })) throw new Error("member_already_exists")
  const token = randomBytes(32).toString("base64url")
  await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: input.workspaceId, email, acceptedAt: null } })
  const invitation = await prisma.workspaceInvitation.create({ data: { workspaceId: input.workspaceId, sentById: input.ownerId, email, role: parseRole(input.role || "member"), tokenHash: invitationHash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } })
  await recordDocumentAudit({ workspaceId: input.workspaceId, actorId: input.ownerId, type: "invitation_created", detail: { email, role: invitation.role } })
  return { token, invitation, workspaceName: workspace.name }
}

/** Expired invitations are included so the table can badge them rather than have them silently
 * vanish; the owner still needs a Revoke button for a row they can see. */
export const listWorkspaceInvitations = cache(async (workspaceId: string) => prisma.workspaceInvitation.findMany({
  where: { workspaceId, acceptedAt: null },
  orderBy: { createdAt: "desc" },
  take: 200,
}))

export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string, actorId: string) {
  // Scoped by workspaceId as well as id: the id alone is a caller-supplied uuid, and matching on
  // it by itself would let an owner of one workspace revoke another workspace's invitation.
  const invitation = await prisma.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId }, select: { email: true } })
  const result = await prisma.workspaceInvitation.deleteMany({ where: { id: invitationId, workspaceId } })
  if (result.count && invitation) {
    await recordDocumentAudit({ workspaceId, actorId, type: "invitation_revoked", detail: { email: invitation.email } })
  }
  return result
}

/** Deliberately NOT cache()-wrapped, unlike its neighbours. This runs on the auth request path
 * (the sign-up gate) outside any React render, where a stale hit would not be a rendering quirk
 * but a security bug: a just-revoked invitation still admitting an account. */
export async function getPendingInvitationForEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  return prisma.workspaceInvitation.findFirst({
    where: { email: normalized, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  })
}

/** Used by the login and signup pages to prefill the email an invitation was addressed to. Returns the email only —
 * the page never needs, and must never leak, anything else about the workspace. */
export async function getInvitationEmailForToken(token: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { tokenHash: invitationHash(token) }, select: { email: true, acceptedAt: true, expiresAt: true } })
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) return null
  return invitation.email
}

export async function acceptWorkspaceInvitation(token: string, user: Pick<User, "id" | "email">) {
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { tokenHash: invitationHash(token) } })
  if (!invitation) throw new Error("invitation_invalid")
  if (invitation.email !== user.email.toLowerCase()) throw new Error("invitation_email_mismatch")
  // Idempotent for the person who already used it: a back button, a second tab, or a re-opened
  // email would otherwise tell an existing member their invitation is unavailable.
  if (invitation.acceptedAt) {
    if (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } } })) return invitation.workspaceId
    throw new Error("invitation_invalid")
  }
  if (invitation.expiresAt < new Date()) throw new Error("invitation_invalid")
  const context = await getRequestAuditContext()
  await prisma.$transaction([
    prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } }, update: { role: invitation.role }, create: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role } }),
    prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    prisma.documentAuditEvent.create({
      data: auditEventData({ workspaceId: invitation.workspaceId, actorId: user.id, type: "invitation_accepted", detail: { role: invitation.role } }, context),
    }),
  ])
  return invitation.workspaceId
}
