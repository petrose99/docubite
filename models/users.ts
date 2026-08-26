import { assertSignupAllowed } from "@/lib/signup-gate"
import { prisma } from "@/lib/db"
import { Prisma, User } from "@/prisma/client"
import { cache } from "react"

export const getUserById = cache((id: string) => prisma.user.findUnique({ where: { id } }))
export const getUserByEmail = cache((email: string) => prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } }))
export const getUserBySupabaseUserId = cache((supabaseUserId: string) => prisma.user.findUnique({ where: { supabaseUserId } }))
export const updateUser = (userId: string, data: Prisma.UserUpdateInput) => prisma.user.update({ where: { id: userId }, data })

/** Resolves the local User row for a Supabase-authenticated visitor, called from
 * lib/auth.ts's getViewerUser() on every request. Three cases, tried in order:
 *
 * 1. Already linked — supabaseUserId matches a row directly. The common case after the first hit.
 * 2. Migrated account — supabaseUserId is unset but the email matches a pre-Supabase row (true of
 *    every existing user until they complete the post-migration password reset and sign in once).
 *    Links it in place, so the row and every one of its 11 FK relations survive untouched.
 * 3. Genuinely new — a fresh sign-up (password or Google) created a Supabase identity with no
 *    matching row at all.
 *
 * Case 3 also re-runs assertSignupAllowed and suspends the row on creation if it fails. This is
 * defense-in-depth, not the primary control — the "Before User Created" Auth Hook
 * (app/api/internal/auth/signup-allowed/route.ts) is supposed to have refused the signup before
 * Supabase ever created the identity this function is now looking at. It exists because that
 * hook's rejection has open reports of not always being honored; see lib/signup-gate.ts. */
export async function resolveOrProvisionUser(input: { supabaseUserId: string; email: string; name?: string | null }): Promise<User> {
  const bySupabaseId = await prisma.user.findUnique({ where: { supabaseUserId: input.supabaseUserId } })
  if (bySupabaseId) return bySupabaseId

  const email = input.email.trim().toLowerCase()
  const byEmail = await prisma.user.findUnique({ where: { email } })
  if (byEmail) {
    // A byEmail row already carrying a DIFFERENT supabaseUserId would mean two Supabase identities
    // are racing to claim one local account — Supabase enforces unique email per project, so this
    // should never happen, but silently overwriting the link here would reassign someone else's
    // account if it somehow did. Fail loudly instead of trusting it.
    if (byEmail.supabaseUserId && byEmail.supabaseUserId !== input.supabaseUserId) throw new Error("email_already_linked_to_different_identity")
    return prisma.user.update({ where: { id: byEmail.id }, data: { supabaseUserId: input.supabaseUserId } })
  }

  const allowed = await assertSignupAllowed(email).then(() => true).catch(() => false)
  return prisma.user.create({
    data: {
      supabaseUserId: input.supabaseUserId,
      email,
      name: input.name?.trim() || email.split("@")[0],
      ...(allowed ? {} : { suspendedAt: new Date() }),
    },
  })
}
