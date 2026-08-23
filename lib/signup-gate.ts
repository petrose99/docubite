import config from "@/lib/config"
import { getPendingInvitationForEmail } from "@/models/workspaces"

/** The DISABLE_SIGNUP gate, with a hole punched in it for invited people.
 *
 * Called from two places, both needed: the "Before User Created" Supabase Auth Hook
 * (app/api/internal/auth/signup-allowed/route.ts), which is the primary control — it runs before
 * Supabase ever creates the auth.users row, so a rejection there means no identity exists at all —
 * and models/users.ts's resolveOrProvisionUser, as a second check on the same rule when a local
 * User row is first created. The second check exists because Supabase's hook-rejection response
 * shape has open reports of not always being honored (see the HIPAA migration plan's Verification
 * section) — if the hook fails to block a signup it should have, resolveOrProvisionUser still
 * catches it and suspends the row on creation rather than leaving the gate single-point-of-failure. */
export async function assertSignupAllowed(email: string) {
  if (!config.auth.disableSignup) return
  if (await getPendingInvitationForEmail(email)) return
  throw new Error("signup_disabled")
}
