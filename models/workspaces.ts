// Deliberately NOT a "use server" module: these are internal data-access helpers that trust
// their caller-supplied arguments (acceptWorkspaceInvitation takes the user to attach). The
// directive would publish every export as a callable endpoint, letting a client pass a forged
// user. Server actions live in app/(app)/workspaces/[workspaceId]/actions.ts and do the auth.
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { getWorkspacePlan, isLimitReached, PLAN_LIMITS_ENFORCED, TRIAL_DAYS, UNLIMITED_LIMITS } from "@/lib/plans"
import { archiveWorkspaceAuditEvents } from "@/lib/audit-archive"
import { deleteDocumentSource } from "@/lib/document-storage"
import { prisma } from "@/lib/db"
import { createFile, deleteFiles } from "@/models/files"
import type { Industry } from "@/types/industry"
import { User } from "@/prisma/client"
import crypto, { randomBytes } from "crypto"
import { cache } from "react"

export type WorkspaceRole = "owner" | "member"
/** "personal" is the implicit one-member workspace every user gets; "team" is the shared kind
 * that only a plan with more than one seat may create. */
export type WorkspaceKind = "personal" | "team"

const invitationHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

const parseRole = (value: unknown): WorkspaceRole => (value === "owner" ? "owner" : "member")

/** Every invariant a mutation depends on has to be read through this, never through
 * getWorkspaceMembership/getWorkspacesForUser/getWorkspaceMembers: those are React-`cache`d, so
 * within one request they would hand back the snapshot from *before* the mutation that is
 * currently running and happily wave through demoting or removing the last owner. */
const countOwners = (workspaceId: string) => prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } })

/* ------------------------------------------------------------------------- admin exemption --- */

/** A workspace is exempt from plan limits when any of its *owners* is a platform admin.
 *
 * Owner rather than member on purpose: an admin invited into a customer's workspace as an
 * ordinary member must not silently lift that customer's plan ceiling. Workspace-shaped rather
 * than acting-user-shaped for the same reason it has to work on the background worker path,
 * where document extraction consumes AI quota with no signed-in user anywhere in scope. */
const EXEMPT_OWNER_FILTER = { role: "owner", user: { role: "admin" } } as const

/** The `include` fragment that answers the exemption question as part of a query that was
 * happening anyway. consumeWorkspaceQuota runs on every `=AI()` cell, so a second roundtrip for
 * a flag that is false for almost every workspace is not worth paying. */
const EXEMPTION_INCLUDE = { workspace: { select: { members: { where: EXEMPT_OWNER_FILTER, select: { userId: true }, take: 1 } } } } as const

/** Deliberately NOT cache()-wrapped, unlike its neighbours: it is consulted before a mutation
 * (an invitation, an accepted seat), where a snapshot from earlier in the same request would
 * wave through the very seat the caller is about to over-allocate. */
export async function isWorkspaceLimitExempt(workspaceId: string) {
  return Boolean(await prisma.workspaceMember.findFirst({ where: { workspaceId, ...EXEMPT_OWNER_FILTER }, select: { userId: true } }))
}

export async function createWorkspaceForUser(user: Pick<User, "id" | "name" | "email">, options: { name?: string; kind?: WorkspaceKind; planCode?: string; industry?: Industry } = {}) {
  // Every workspace starts on a trial, and this is the only place one is created — including the
  // lazy creation on the first /workspaces visit, which is what puts password sign-ups and
  // Google sign-ups on identical footing without either auth path knowing about billing.
  // WorkspaceSubscription.status already defaults to "trialing"; this is the clock for it.
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
  const workspace = await prisma.workspace.create({
    data: {
      name: options.name?.trim() || `${user.name || user.email}'s workspace`,
      kind: options.kind || "personal",
      // "finance" is the primary buyer going forward — see docs on Workspace.industry.
      // The team-workspace creation form is the picker that passes "healthcare" through here; the
      // lazily-created personal workspace (first /workspaces visit) never does, so it always
      // defaults to finance — there is no onboarding step in that path to ask the question.
      industry: options.industry || "finance",
      members: { create: { userId: user.id, role: "owner" } },
      subscription: { create: { trialEndsAt, ...(options.planCode ? { planCode: options.planCode } : {}) } },
    },
    include: { subscription: true },
  })
  // The worksheets a new user starts with now live on their first file, not on the workspace.
  await createFile({ workspaceId: workspace.id, userId: user.id })
  return workspace
}

/** Lido's Workspace nav item: a shared team, which the entry plan's single seat does not
 * allow. Gated here as well as in the UI so the upsell cannot be clicked past.
 *
 * industry has to be chosen HERE, at creation, not set afterward: createWorkspaceForUser seeds
 * a file immediately (the line below this comment in that function), so by the time control
 * returns to any caller the workspace already has content and setIndustry's lock has already
 * engaged — there is no "create empty, then pick an industry" window in practice. */
export async function createTeamWorkspace(user: Pick<User, "id" | "name" | "email" | "role">, name: string, industry?: Industry) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, role: "owner" },
    include: { workspace: { include: { subscription: true } } },
  })
  const best = memberships
    .map((membership) => getWorkspacePlan(membership.workspace.subscription?.planCode || "starter"))
    .reduce((strongest, plan) => (plan.limits.members < 0 || plan.limits.members > strongest.limits.members ? plan : strongest), getWorkspacePlan("starter"))
  // Read off the acting user here rather than through isWorkspaceLimitExempt: the workspace this
  // gate protects does not exist yet, so there is nothing to look an owner up on.
  if (user.role !== "admin" && isLimitReached(1, best.limits.members)) throw new Error("team_workspaces_require_upgrade")
  // The new workspace inherits the plan that authorised its creation. Dropping it would put the
  // team on the default 1-seat starter subscription, so the owner could create the workspace and
  // then immediately be told they have no seat to invite anyone into.
  return createWorkspaceForUser(user, { name, kind: "team", planCode: best.code, industry })
}

export const getWorkspacesForUser = cache(async (userId: string) => prisma.workspace.findMany({
  where: { members: { some: { userId } } },
  include: { members: { where: { userId }, select: { role: true } }, subscription: true },
  orderBy: { createdAt: "asc" },
}))

export async function getOrCreateWorkspaceForUser(user: Pick<User, "id" | "name" | "email">) {
  const memberships = await getWorkspacesForUser(user.id)
  return memberships[0] || createWorkspaceForUser(user)
}

export const getWorkspaceMembership = cache(async (workspaceId: string, userId: string) => prisma.workspaceMember.findUnique({
  where: { workspaceId_userId: { workspaceId, userId } },
  include: { workspace: { include: { subscription: true } } },
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

/* ---------------------------------------------------------------- workspace lifecycle --- */

export async function renameWorkspace(workspaceId: string, name: string) {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 80) throw new Error("invalid_workspace_name")
  return prisma.workspace.update({ where: { id: workspaceId }, data: { name: trimmed } })
}

/** Whether a workspace can still change its industry: only before it has any content. A file
 * (or the documents inside it) was seeded according to the industry active at the time — worksheets
 * for finance, the dictation container for healthcare — so switching after the fact would leave
 * that content orphaned rather than actually reclassifying anything. */
async function hasWorkspaceContent(workspaceId: string): Promise<boolean> {
  return Boolean(await prisma.documentFile.findFirst({ where: { workspaceId }, select: { id: true } }))
}

/** Sets the workspace's industry — the keystone gate for everything industry-specific (nav
 * entries, seeded templates, the AI prompt preamble). Locked once the workspace has any content
 * (`product_mode_locked`), and coupled to hipaaMode: a workspace presumed to handle ePHI cannot
 * be finance-mode (`hipaa_mode_requires_clinical`) — hipaaMode has to come off first, through
 * the workspace's own HIPAA toggle, rather than being silently cleared as a side effect here. */
export async function setIndustry(input: { workspaceId: string; actorId: string; mode: Industry }): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { industry: true, hipaaMode: true } })
  if (workspace.industry === input.mode) return
  if (workspace.hipaaMode && input.mode !== "healthcare") throw new Error("hipaa_mode_requires_clinical")
  if (await hasWorkspaceContent(input.workspaceId)) throw new Error("product_mode_locked")
  const context = await getRequestAuditContext()
  await prisma.$transaction([
    prisma.workspace.update({ where: { id: input.workspaceId }, data: { industry: input.mode } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, actorId: input.actorId, type: "workspace_product_mode_set", detail: { mode: input.mode } }, context) }),
  ])
}

/** Deliberately does NOT re-check the plan's seat limit: seats gate *adding* people, and a
 * workspace that has been downgraded below its current head-count would otherwise be frozen —
 * the owner could no longer even reorganise roles to help themselves back under the limit. */
export async function updateWorkspaceMemberRole(input: { workspaceId: string; memberUserId: string; role: WorkspaceRole }) {
  const role = parseRole(input.role)
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.memberUserId } } })
  if (!member) throw new Error("member_not_found")
  if (member.role === "owner" && role !== "owner" && (await countOwners(input.workspaceId)) <= 1) throw new Error("last_owner_required")
  return prisma.workspaceMember.update({ where: { id: member.id }, data: { role } })
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
  await prisma.$transaction([
    prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } }, data: { role: "owner" } }),
    ...(stepDown ? [prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.actorId } }, data: { role: "member" } })] : []),
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
  const subscription = await prisma.workspaceSubscription.findUnique({ where: { workspaceId: input.workspaceId } })
  // Deliberately no Stripe API call: cancelling someone's billing as a side effect of a delete
  // button is not a decision this path should be making. Send them to Billing instead.
  if (subscription?.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(subscription.status)) throw new Error("cancel_subscription_first")

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

function defaultUsagePeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

export async function consumeWorkspaceQuota(workspaceId: string, kind: "document" | "ai", now = new Date()) {
  const subscription = await prisma.workspaceSubscription.findUnique({ where: { workspaceId }, include: EXEMPTION_INCLUDE })
  const exempt = Boolean(subscription?.workspace.members.length)
  const plan = getWorkspacePlan(subscription?.planCode || "starter")
  const limits = exempt ? UNLIMITED_LIMITS : plan.limits
  // Not gated on PLAN_LIMITS_ENFORCED: this is an affirmative statement from Stripe that the
  // money stopped, not a plan ceiling. An admin-owned workspace has no Stripe relationship worth
  // honouring, so it skips both this and the trial clock below.
  if (!exempt && ["canceled", "past_due", "unpaid"].includes(subscription?.status || "")) throw new Error("subscription_inactive")
  // The hole this closes: `status` stays "trialing" forever once the trial lapses — Stripe never
  // moves it, because a workspace that never opened checkout has no Stripe subscription to emit
  // an event. Without this, a 14-day trial is an unlimited free plan. Reads are untouched; only
  // the quota-consuming actions stop.
  if (PLAN_LIMITS_ENFORCED && !exempt && subscription?.status === "trialing" && subscription.trialEndsAt && subscription.trialEndsAt < now) throw new Error("trial_expired")
  const period = subscription?.currentPeriodStart && subscription.currentPeriodEnd
    ? { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd }
    : defaultUsagePeriod(now)
  const usage = await prisma.workspaceUsagePeriod.upsert({
    where: { workspaceId_periodStart: { workspaceId, periodStart: period.start } },
    create: { workspaceId, periodStart: period.start, periodEnd: period.end },
    update: { periodEnd: period.end },
  })
  const field = kind === "document" ? "inboundDocumentCount" : "aiExtractionCount"
  // An exempt workspace still increments — the meters on Billing & Usage are the only view of
  // what an admin account actually costs, and zeroing them would hide it.
  const limit = kind === "document" ? limits.documents : limits.ai
  const claimed = limit < 0
    ? await prisma.workspaceUsagePeriod.updateMany({ where: { id: usage.id }, data: { [field]: { increment: 1 } } })
    : await prisma.workspaceUsagePeriod.updateMany({ where: { id: usage.id, [field]: { lt: limit } }, data: { [field]: { increment: 1 } } })
  if (!claimed.count) throw new Error(kind === "document" ? "document_quota_exhausted" : "ai_quota_exhausted")
  return { period, plan }
}

/** Read-side of consumeWorkspaceQuota for the usage meter: same subscription-period-or-
 * calendar-month window, same plan limits, no writes. Keep the period math in lockstep with
 * consumeWorkspaceQuota or the meter will drift from what enforcement actually allows. */
export async function getWorkspaceUsage(workspaceId: string, now = new Date()) {
  const subscription = await prisma.workspaceSubscription.findUnique({ where: { workspaceId }, include: EXEMPTION_INCLUDE })
  const exempt = Boolean(subscription?.workspace.members.length)
  const plan = getWorkspacePlan(subscription?.planCode || "starter")
  const limits = exempt ? UNLIMITED_LIMITS : plan.limits
  const period = subscription?.currentPeriodStart && subscription.currentPeriodEnd
    ? { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd }
    : defaultUsagePeriod(now)
  const usage = await prisma.workspaceUsagePeriod.findUnique({ where: { workspaceId_periodStart: { workspaceId, periodStart: period.start } } })
  return {
    planName: plan.name,
    documentsUsed: usage?.inboundDocumentCount ?? 0,
    documentsLimit: limits.documents,
    aiUsed: usage?.aiExtractionCount ?? 0,
    aiLimit: limits.ai,
    /** So Billing & Usage can say *why* the meters read unlimited, rather than implying the
     * plan itself has no ceiling. */
    exempt,
  }
}

/** Returns the workspace name alongside the token so the caller can compose the invitation
 * email without a second query for something it just read. */
export async function createWorkspaceInvitation(input: { workspaceId: string; ownerId: string; email: string; role?: WorkspaceRole }) {
  await requireWorkspaceRole(input.workspaceId, input.ownerId, ["owner"])
  const [workspace, memberCount, exempt] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, include: { subscription: true } }),
    prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
    isWorkspaceLimitExempt(input.workspaceId),
  ])
  const plan = getWorkspacePlan(workspace.subscription?.planCode || "starter")
  if (!exempt && isLimitReached(memberCount, plan.limits.members)) throw new Error("member_quota_exhausted")
  const email = input.email.trim().toLowerCase()
  const owner = await prisma.user.findUnique({ where: { id: input.ownerId }, select: { email: true } })
  if (owner && owner.email.toLowerCase() === email) throw new Error("self_invite")
  if (await prisma.workspaceMember.findFirst({ where: { workspaceId: input.workspaceId, user: { email } } })) throw new Error("member_already_exists")
  const token = randomBytes(32).toString("base64url")
  await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: input.workspaceId, email, acceptedAt: null } })
  const invitation = await prisma.workspaceInvitation.create({ data: { workspaceId: input.workspaceId, sentById: input.ownerId, email, role: parseRole(input.role || "member"), tokenHash: invitationHash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } })
  return { token, invitation, workspaceName: workspace.name }
}

/** Expired invitations are included so the table can badge them rather than have them silently
 * vanish; the owner still needs a Revoke button for a row they can see. */
export const listWorkspaceInvitations = cache(async (workspaceId: string) => prisma.workspaceInvitation.findMany({
  where: { workspaceId, acceptedAt: null },
  orderBy: { createdAt: "desc" },
  take: 200,
}))

export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
  // Scoped by workspaceId as well as id: the id alone is a caller-supplied uuid, and matching on
  // it by itself would let an owner of one workspace revoke another workspace's invitation.
  return prisma.workspaceInvitation.deleteMany({ where: { id: invitationId, workspaceId } })
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
  const [workspace, count, exempt] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: invitation.workspaceId }, include: { subscription: true } }),
    prisma.workspaceMember.count({ where: { workspaceId: invitation.workspaceId } }),
    isWorkspaceLimitExempt(invitation.workspaceId),
  ])
  const plan = getWorkspacePlan(workspace.subscription?.planCode || "starter")
  const existing = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } } })
  if (!existing && !exempt && isLimitReached(count, plan.limits.members)) throw new Error("member_quota_exhausted")
  await prisma.$transaction([
    prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } }, update: { role: invitation.role }, create: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role } }),
    prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
  ])
  return invitation.workspaceId
}
