import { randomBytes } from "crypto"
import { recordSystemAudit } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { unscoped } from "@/lib/workspace-scope"
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto"
import { backoffMinutes } from "@/lib/webhook-delivery-policy"
import { IntegrationAuthError, IntegrationPermanentError, safeErrorCode } from "@/lib/integrations/errors"
import * as bigcapital from "@/lib/integrations/bigcapital/client"
import { syncAccountingEntities } from "@/lib/integrations/sync"
import { getWorkspaceIntegrationConnection, upsertWorkspaceIntegrationConnection } from "@/models/integrations"

/** Provisions the auto-created, per-workspace Bigcapital organization: sign up a workspace-scoped
 * Bigcapital account, build its (one and only) organization, mint an API key, and seal it into an
 * IntegrationConnection — the same connection row QuickBooks/Xero use, so the existing push/sync
 * machinery needs no bigcapital-specific branch to consume it. Modelled on lib/integration-push.ts's
 * claim/attempt/drain trio: a durable, retried queue row (IntegrationProvisionJob) rather than a
 * blocking call on the signup request.
 *
 * One Bigcapital ACCOUNT per WORKSPACE, not per DocuBite user — confirmed against a real running
 * Bigcapital instance that a second `buildOrganization` on an already-built account fails with
 * `TENANT_ALREADY_BUILT`; there is no way to own more than one organization per login. Each
 * workspace's account signs up under a `+ws_<workspaceId>` alias of the triggering user's real
 * email (see buildAliasEmail) — a distinct, valid, traceable login every workspace can have without
 * asking anyone to register a separate real email address by hand. */

const MAX_PROVISION_ATTEMPTS = 10
/** Provisioning is several sequential network calls (signup, sign-in, build, poll, mint key) plus a
 * chart-of-accounts sync — longer than a single push's lease, shorter than a document job's. */
const PROVISION_LEASE_MS = 5 * 60 * 1000
const BUILD_POLL_INTERVAL_MS = 3000
const BUILD_POLL_ATTEMPTS = 5

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bigcapital's password policy is unknown ahead of time, so the generated password mixes a long
 * random segment with a fixed upper/digit/symbol suffix to satisfy typical complexity rules without
 * guessing the exact policy. */
function generatePassword(): string {
  return `${randomBytes(18).toString("base64url")}Aa1!`
}

function splitName(name: string, email: string): { firstName: string; lastName: string } {
  const parts = (name || email.split("@")[0]).trim().split(/\s+/)
  return { firstName: parts[0] || "DocuBite", lastName: parts.slice(1).join(" ") || "User" }
}

/** A `local+ws_<workspaceId>@domain` alias of the triggering user's real email — distinct per
 * workspace (so each gets its own Bigcapital login) while still a valid, deliverable address and
 * traceable back to who it's for. Bigcapital validates this with a standard `isEmail` check, which
 * the `+tag` form satisfies. */
function buildAliasEmail(baseEmail: string, workspaceId: string): string {
  const at = baseEmail.lastIndexOf("@")
  if (at < 0) return baseEmail
  return `${baseEmail.slice(0, at)}+ws_${workspaceId}${baseEmail.slice(at)}`
}

/** Ensures a BigcapitalAccount exists for this workspace, signing up its real Bigcapital account on
 * first use. `owner` supplies the real name/email the alias and display name are derived from. */
export async function getOrCreateBigcapitalAccount(workspace: { id: string }, owner: { id: string; name: string; email: string }) {
  const existing = await prisma.bigcapitalAccount.findUnique({ where: { workspaceId: workspace.id } })
  if (existing) return existing

  const password = generatePassword()
  const aliasEmail = buildAliasEmail(owner.email, workspace.id)
  const { firstName, lastName } = splitName(owner.name, owner.email)
  const signedUp = await bigcapital.signup({ firstName, lastName, email: aliasEmail, password })

  return prisma.bigcapitalAccount.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      bigcapitalUserId: signedUp.userId,
      organizationId: signedUp.organizationId,
      email: aliasEmail,
      passwordEnc: encryptSecret(password),
      status: "active",
    },
  })
}

/** The user whose real email the workspace's Bigcapital alias is derived from: the pinned owner
 * captured on the job row at enqueue/repair time if one was recorded, falling back to the
 * workspace's current owner for a job row from before that column existed. Resolving the CURRENT
 * owner on every retry (rather than once) would let a mid-flight ownership transfer silently
 * rename which user a first-time signup's alias/display name is derived from. */
async function resolveProvisionUser(workspaceId: string, ownerUserId: string | null): Promise<{ id: string; name: string; email: string }> {
  if (ownerUserId) {
    const user = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true, name: true, email: true } })
    if (user) return user
  }
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!membership) throw new Error("workspace_owner_not_found")
  return membership.user
}

type ProvisionOutcome = { success: boolean; errorCode: string | null; retryable: boolean; buildJobId: string | null }

/** `existingBuildJobId` resumes polling an in-flight Bigcapital org build from a prior attempt that
 * timed out waiting for it, rather than starting a second one (which would fail anyway —
 * TENANT_ALREADY_BUILT — but wastes a round trip and a poll cycle first) — see
 * IntegrationProvisionJob.externalRef. Returns the build job id to persist on the row for the NEXT
 * attempt (null once it's no longer needed: the build finished, or failed terminally). */
async function buildAndConnect(workspace: { id: string; name: string }, ownerUserId: string | null, existingBuildJobId: string | null): Promise<ProvisionOutcome> {
  // Idempotency short-circuit: a connection that's already active means this workspace's org was
  // already built successfully by an earlier attempt (or the job row and the connection fell out of
  // sync — a crash between this function returning success and the job being marked succeeded, or
  // the owner clicking "Repair" on a connection that was never actually broken). Either way, there
  // is nothing left to build; re-running buildOrganization here would hit TENANT_ALREADY_BUILT for
  // no reason.
  const existingConnection = await getWorkspaceIntegrationConnection(workspace.id, "bigcapital")
  if (existingConnection?.status === "active") return { success: true, errorCode: null, retryable: false, buildJobId: null }

  const user = await resolveProvisionUser(workspace.id, ownerUserId)
  const account = await getOrCreateBigcapitalAccount(workspace, user)
  if (!account.organizationId) return { success: false, errorCode: "bigcapital_organization_missing", retryable: false, buildJobId: null }
  const password = decryptSecret(account.passwordEnc)

  const session = await bigcapital.signIn(account.email, password)

  let jobId = existingBuildJobId
  if (!jobId) {
    const built = await bigcapital.buildOrganization(session.token, account.organizationId, {
      name: workspace.name,
      location: "US",
      baseCurrency: "USD",
      timezone: "UTC",
      fiscalYear: "january",
      language: "en",
    })
    // alreadyBuilt: a prior attempt's build succeeded but crashed before this job row (or the
    // connection) was updated to reflect it — nothing left to poll, go straight to minting a key.
    if (!built.alreadyBuilt) jobId = built.jobId
  }

  if (jobId) {
    let status = await bigcapital.getBuildJobStatus(session.token, account.organizationId, jobId)
    for (let i = 0; i < BUILD_POLL_ATTEMPTS && !status.completed && !status.failed; i++) {
      await sleep(BUILD_POLL_INTERVAL_MS)
      status = await bigcapital.getBuildJobStatus(session.token, account.organizationId, jobId)
    }
    if (status.failed) return { success: false, errorCode: "bigcapital_build_failed", retryable: false, buildJobId: null }
    if (!status.completed) return { success: false, errorCode: "bigcapital_build_pending", retryable: true, buildJobId: jobId }
  }

  const apiKey = await bigcapital.createApiKey(session.token, account.organizationId, `docubite-${workspace.id}`)

  // refreshTokenEnc has no meaning for an API-key connector — sealed with the same key so the
  // column's NOT NULL constraint (shared with the OAuth providers) is satisfied without a schema
  // change, and access_token_expires_at is set a century out so getValidAccessToken never attempts
  // the OAuth refresh path for this connection (lib/integration-token-refresh.ts refuses it
  // explicitly if that path is ever reached anyway).
  const connection = await upsertWorkspaceIntegrationConnection(workspace.id, {
    provider: "bigcapital",
    externalTenantId: account.organizationId,
    tenantName: workspace.name,
    accessTokenEnc: encryptSecret(apiKey.key),
    refreshTokenEnc: encryptSecret(apiKey.key),
    accessTokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
    refreshTokenExpiresAt: null,
    scope: null,
    createdById: user.id,
  })

  await syncAccountingEntities(connection.id).catch((error) => {
    console.error("[bigcapital] initial sync failed; connection is active regardless:", error instanceof Error ? error.message : error)
  })

  return { success: true, errorCode: null, retryable: false, buildJobId: null }
}

/** Enqueues (or resets, if a prior job failed) the provisioning job for a workspace, pinning
 * `ownerUserId` as the identity this attempt (and any later retry of it) provisions under. */
export async function enqueueBigcapitalProvisionJob(workspaceId: string, ownerUserId: string): Promise<void> {
  await prisma.integrationProvisionJob.upsert({
    where: { workspaceId_provider: { workspaceId, provider: "bigcapital" } },
    create: { workspaceId, provider: "bigcapital", ownerUserId, status: "pending", nextAttemptAt: new Date() },
    update: { ownerUserId, status: "pending", attempts: 0, nextAttemptAt: new Date(), leaseUntil: null, errorCode: null, completedAt: null, externalRef: null },
  })
}

export async function claimNextProvisionJob(now = new Date()): Promise<string | null> {
  const dueLease = { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }
  const candidate = await prisma.integrationProvisionJob.findFirst({
    where: { status: "pending", nextAttemptAt: { lte: now }, ...dueLease },
    orderBy: { nextAttemptAt: "asc" },
    select: { id: true },
  })
  if (!candidate) return null
  const claimed = await prisma.integrationProvisionJob.updateMany({
    where: { id: candidate.id, status: "pending", ...dueLease },
    data: { leaseUntil: new Date(now.getTime() + PROVISION_LEASE_MS) },
  })
  return claimed.count ? candidate.id : null
}

/** Attempts one claimed provisioning job and records the outcome. Never throws — every failure path
 * is caught and recorded on the row, exactly like attemptIntegrationPush. An error thrown by the
 * bigcapital client is classified via the same IntegrationAuthError/PermanentError/RetryableError
 * taxonomy attemptIntegrationPush uses, so a permanent failure (bad request shape, revoked account)
 * fails the job immediately instead of burning all MAX_PROVISION_ATTEMPTS retries on something that
 * can never succeed without a person fixing it first. */
export async function attemptProvisionJob(jobId: string, now = new Date()): Promise<void> {
  const job = await prisma.integrationProvisionJob.findUnique({
    where: { id: jobId },
    select: { id: true, workspaceId: true, status: true, attempts: true, ownerUserId: true, externalRef: true, workspace: { select: { id: true, name: true } } },
  })
  if (!job || job.status !== "pending") return

  let outcome: ProvisionOutcome
  try {
    outcome = await buildAndConnect(job.workspace, job.ownerUserId, job.externalRef)
  } catch (error) {
    outcome = {
      success: false,
      errorCode: safeErrorCode(error),
      retryable: !(error instanceof IntegrationAuthError || error instanceof IntegrationPermanentError),
      buildJobId: job.externalRef,
    }
  }

  const attempts = job.attempts + 1
  if (outcome.success) {
    await prisma.integrationProvisionJob.update({
      where: { id: job.id },
      data: { status: "succeeded", attempts, leaseUntil: null, errorCode: null, externalRef: null, completedAt: now },
    })
    await recordSystemAudit({ workspaceId: job.workspaceId, type: "bigcapital_provisioned", detail: { provider: "bigcapital", attempts } })
    return
  }

  const exhausted = !outcome.retryable || attempts >= MAX_PROVISION_ATTEMPTS
  await prisma.integrationProvisionJob.update({
    where: { id: job.id },
    data: {
      status: exhausted ? "failed" : "pending",
      attempts,
      leaseUntil: null,
      nextAttemptAt: exhausted ? now : new Date(now.getTime() + backoffMinutes(attempts) * 60_000),
      errorCode: outcome.errorCode,
      externalRef: exhausted ? null : outcome.buildJobId,
      completedAt: exhausted ? now : null,
    },
  })
  // Terminal only — a retryable attempt just tries again, and auditing every intermediate retry
  // would drown the terminal failure that actually matters in noise.
  if (exhausted) {
    await recordSystemAudit({ workspaceId: job.workspaceId, type: "bigcapital_provision_failed", detail: { provider: "bigcapital", errorCode: outcome.errorCode, attempts } })
  }
}

export async function processNextProvisionJob(now = new Date()): Promise<string | null> {
  return unscoped(async () => {
    const id = await claimNextProvisionJob(now)
    if (!id) return null
    await attemptProvisionJob(id, now)
    return id
  })
}

/** The Accounting tab's connection card reads this to show "provisioning…" / "repair" states before
 * (or instead of) an IntegrationConnection row existing at all. */
export async function getWorkspaceProvisionJob(workspaceId: string) {
  return prisma.integrationProvisionJob.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "bigcapital" } },
    select: { status: true, attempts: true, errorCode: true, nextAttemptAt: true, updatedAt: true },
  })
}

export async function drainProvisionJobs(max = 20): Promise<number> {
  let processed = 0
  for (let i = 0; i < max; i++) {
    const id = await processNextProvisionJob()
    if (!id) break
    processed++
  }
  return processed
}
