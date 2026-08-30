/** Demo and admin accounts for a local install.
 *
 * Deliberately talks to Prisma directly instead of going through lib/auth.ts. That module pulls
 * in next/headers, which throws the moment it is imported outside a request — so the "correct"
 * route of calling getViewerUser cannot run under tsx at all. What it does instead is provision
 * both halves by hand: a Supabase identity via the admin API (real password, email pre-confirmed
 * — these are synthetic accounts, not migrated ones, so there is no reset flow to route them
 * through) and the matching local User row, linked by supabaseUserId exactly the way
 * resolveOrProvisionUser links a real sign-up.
 *
 * Run with: npm run db:seed  (dev server stopped — the local PGlite database takes one connection)
 */
import { createAdminClient } from "@/lib/supabase/server"
import { createWorkspaceForUser } from "@/models/workspaces"
import { prisma } from "@/lib/db"

type DemoAccount = { email: string; name: string; role: string; password: string }

/** Fixed, obviously-local passwords: the point of a demo account is that someone can sign in
 * without going hunting, and these only ever exist on a developer's machine. The production
 * guard below is what keeps them there. */
const ACCOUNTS: DemoAccount[] = [
  { email: "admin@docubite.local", name: "DocuBite Admin", role: "admin", password: "admin-docubite-2026" },
  { email: "demo@docubite.local", name: "Demo User", role: "user", password: "demo-docubite-2026" },
]

/** Provisions (or updates) the Supabase Auth identity for one demo account, returning its
 * supabaseUserId. Looked up by the LOCAL row's already-linked id first, not by asking Supabase to
 * search by email — that keeps this idempotent without needing a second Supabase API round trip
 * on every re-run, and re-running re-syncs the password so a changed ACCOUNTS entry (or a demo
 * password fiddled with by hand) never goes stale. */
async function upsertSupabaseIdentity(email: string, password: string, name: string): Promise<string> {
  const admin = createAdminClient()
  const existing = await prisma.user.findUnique({ where: { email }, select: { supabaseUserId: true } })
  if (existing?.supabaseUserId) {
    await admin.auth.admin.updateUserById(existing.supabaseUserId, { password })
    return existing.supabaseUserId
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
  if (error || !data.user) throw new Error(`Could not create Supabase user for ${email}: ${error?.message}`)
  return data.user.id
}

async function seedAccount(account: DemoAccount) {
  const supabaseUserId = await upsertSupabaseIdentity(account.email, account.password, account.name)
  const user = await prisma.user.upsert({
    where: { email: account.email },
    create: { email: account.email, name: account.name, role: account.role, emailVerified: true, supabaseUserId },
    update: { name: account.name, role: account.role, supabaseUserId },
  })

  // createWorkspaceForUser also seeds the starter file and worksheets a real sign-up gets, so a
  // demo account opens on a working sheet rather than an empty shell. Only on the first run:
  // re-seeding must not hand the account a second workspace every time.
  const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
  if (!membership) await createWorkspaceForUser(user)

  return { email: account.email, password: account.password, role: account.role }
}

async function main() {
  // These are known credentials with an admin account among them. Seeding them into a real
  // deployment would hand anyone who reads this file an admin login.
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO_ACCOUNTS !== "true") {
    throw new Error("Refusing to seed demo accounts in production. Set SEED_DEMO_ACCOUNTS=true if this is genuinely what you want.")
  }

  const seeded = []
  for (const account of ACCOUNTS) seeded.push(await seedAccount(account))

  console.log("\nSeeded accounts:\n")
  for (const row of seeded) console.log(`  ${row.email.padEnd(30)} ${row.password.padEnd(24)} ${row.role}`)
  console.log("")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
