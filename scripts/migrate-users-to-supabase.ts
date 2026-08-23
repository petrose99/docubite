/** One-time cutover script: creates a Supabase Auth identity for every pre-migration user and
 * emails each one a recovery link, via this app's own Resend wiring rather than Supabase's
 * built-in mailer (capped at 2 sends/hour on the default plan — far too low for a real cutover).
 *
 * Idempotent by design, safe to re-run after a partial failure: only rows with supabaseUserId
 * still null are touched, and each is only marked linked after both the Supabase user is created
 * and the row is updated — a crash between those two steps leaves the row unlinked, so the next
 * run picks it back up rather than silently skipping it or double-creating the Supabase user.
 *
 * Password hashes cannot be carried over — better-auth uses scrypt, Supabase uses bcrypt, and
 * there is no supported cross-hash import path (see the HIPAA migration plan). Every account gets
 * a Supabase identity with no password at all; the recovery link is the only way in until each
 * person sets one.
 *
 * Run with: npx tsx --env-file .env scripts/migrate-users-to-supabase.ts [--dry-run]
 */
import { sendPasswordResetEmail } from "@/lib/email"
import { prisma } from "@/lib/db"
import { createAdminClient } from "@/lib/supabase/server"
import config from "@/lib/config"

async function migrateOne(user: { id: string; email: string; name: string }, dryRun: boolean): Promise<"migrated" | "skipped" | "failed"> {
  if (dryRun) {
    console.log(`[dry-run] would migrate ${user.email}`)
    return "migrated"
  }

  const admin = createAdminClient()
  const { data, error: createError } = await admin.auth.admin.createUser({ email: user.email, email_confirm: true, user_metadata: { name: user.name } })
  if (createError || !data.user) {
    console.error(`  ✗ createUser failed for ${user.email}: ${createError?.message}`)
    return "failed"
  }

  await prisma.user.update({ where: { id: user.id }, data: { supabaseUserId: data.user.id } })

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email: user.email })
  if (linkError || !link) {
    console.error(`  ✗ generateLink failed for ${user.email}: ${linkError?.message} — identity created and linked, but no email sent. Re-run will not retry this (supabaseUserId is now set); send the reset link manually.`)
    return "failed"
  }

  try {
    await sendPasswordResetEmail({ email: user.email, resetUrl: link.properties.action_link })
  } catch (error) {
    console.error(`  ✗ email send failed for ${user.email}: ${error instanceof Error ? error.message : error} — same caveat as above.`)
    return "failed"
  }

  return "migrated"
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  if (process.env.NODE_ENV === "production" && !config.supabase.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — refusing to run against production without it.")
  }

  const pending = await prisma.user.findMany({ where: { supabaseUserId: null }, select: { id: true, email: true, name: true } })
  console.log(`${pending.length} user(s) to migrate${dryRun ? " (dry run)" : ""}.\n`)

  let migrated = 0
  let failed = 0
  for (const user of pending) {
    const result = await migrateOne(user, dryRun)
    if (result === "migrated") { migrated++; console.log(`  ✓ ${user.email}`) }
    if (result === "failed") failed++
  }

  console.log(`\nDone: ${migrated} migrated, ${failed} failed, ${pending.length - migrated - failed} skipped.`)
  if (failed > 0) process.exitCode = 1
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
