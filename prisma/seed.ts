/** Demo and admin accounts for a local install.
 *
 * Deliberately talks to Prisma directly instead of going through lib/auth.ts. That module pulls
 * in next/headers, which throws the moment it is imported outside a request — so the "correct"
 * route of calling better-auth's sign-up API cannot run under tsx at all. What it does instead is
 * write exactly what better-auth writes: a User row, and an Account row with providerId
 * "credential" and the scrypt hash from better-auth's own hashPassword, which is the same
 * function the configured instance verifies against at sign-in.
 *
 * Every account is seeded with a plan but NO Stripe customer or subscription id. That is what
 * keeps them useful: deleteWorkspace refuses to delete a workspace with a live Stripe
 * subscription attached, and the checkout route now refuses a second one — so a demo account
 * carrying fake Stripe ids would be both undeletable and unable to test checkout.
 *
 * Run with: npm run db:seed  (dev server stopped — the local PGlite database takes one connection)
 */
import { createWorkspaceForUser } from "@/models/workspaces"
import { hashPassword } from "better-auth/crypto"
import { prisma } from "@/lib/db"

type DemoAccount = { email: string; name: string; role: string; planCode: string; password: string }

/** Fixed, obviously-local passwords: the point of a demo account is that someone can sign in
 * without going hunting, and these only ever exist on a developer's machine. The production
 * guard below is what keeps them there. */
const ACCOUNTS: DemoAccount[] = [
  { email: "admin@docubite.local", name: "DocuBite Admin", role: "admin", planCode: "enterprise", password: "admin-docubite-2026" },
  { email: "demo-starter@docubite.local", name: "Demo Starter", role: "user", planCode: "starter", password: "demo-starter-2026" },
  { email: "demo-growth@docubite.local", name: "Demo Growth", role: "user", planCode: "growth", password: "demo-growth-2026" },
  { email: "demo-enterprise@docubite.local", name: "Demo Enterprise", role: "user", planCode: "enterprise", password: "demo-enterprise-2026" },
]

/** The window consumeWorkspaceQuota falls back to when a subscription has no Stripe period —
 * kept identical to defaultUsagePeriod in models/workspaces.ts so the seeded subscription and the
 * usage rows the app writes agree on which month they are in. */
function currentPeriod(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  }
}

/** Account has no compound unique on (providerId, userId), so this is find-then-write rather than
 * an upsert. Re-running the seed re-hashes and overwrites the password, which is what makes it
 * safe to run after someone has changed one by hand and forgotten. */
async function upsertCredentialAccount(userId: string, password: string) {
  const hash = await hashPassword(password)
  const existing = await prisma.account.findFirst({ where: { userId, providerId: "credential" } })
  if (existing) return prisma.account.update({ where: { id: existing.id }, data: { password: hash } })
  return prisma.account.create({ data: { providerId: "credential", accountId: userId, userId, password: hash } })
}

async function seedAccount(account: DemoAccount) {
  const user = await prisma.user.upsert({
    where: { email: account.email },
    create: { email: account.email, name: account.name, role: account.role, emailVerified: true },
    update: { name: account.name, role: account.role },
  })
  await upsertCredentialAccount(user.id, account.password)

  // createWorkspaceForUser also seeds the starter file and worksheets a real sign-up gets, so a
  // demo account opens on a working sheet rather than an empty shell. Only on the first run:
  // re-seeding must not hand the account a second workspace every time.
  const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
  const workspaceId = membership?.workspaceId ?? (await createWorkspaceForUser(user, { planCode: account.planCode })).id

  const period = currentPeriod()
  // status "active" with trialEndsAt cleared: these accounts exist to demonstrate a paid plan, and
  // leaving them "trialing" would have them expire out from under a demo two weeks later.
  await prisma.workspaceSubscription.upsert({
    where: { workspaceId },
    create: { workspaceId, planCode: account.planCode, status: "active", trialEndsAt: null, currentPeriodStart: period.start, currentPeriodEnd: period.end },
    update: { planCode: account.planCode, status: "active", trialEndsAt: null, cancelAtPeriodEnd: false, currentPeriodStart: period.start, currentPeriodEnd: period.end },
  })
  return { email: account.email, password: account.password, role: account.role, planCode: account.planCode }
}

async function main() {
  // These are known credentials with an admin account among them. Seeding them into a real
  // deployment would hand anyone who reads this file a limit-exempt login.
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO_ACCOUNTS !== "true") {
    throw new Error("Refusing to seed demo accounts in production. Set SEED_DEMO_ACCOUNTS=true if this is genuinely what you want.")
  }

  const seeded = []
  for (const account of ACCOUNTS) seeded.push(await seedAccount(account))

  console.log("\nSeeded accounts:\n")
  for (const row of seeded) console.log(`  ${row.email.padEnd(30)} ${row.password.padEnd(24)} ${row.role.padEnd(6)} ${row.planCode}`)
  console.log("")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
