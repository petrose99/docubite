import config from "@/lib/config"
import { getPendingInvitationForEmail } from "@/models/workspaces"
import { APIError } from "better-auth/api"

/** The DISABLE_SIGNUP gate, with a hole punched in it for invited people.
 *
 * Lives in its own module rather than inline in lib/auth.ts because that file calls betterAuth()
 * at module scope — importing it from a test would build a real auth instance and a Prisma
 * adapter. This is the same rule, callable on its own.
 *
 * Throws rather than returning false: better-auth's user.create.before hook treats a `false`
 * return as "skip the create", which yields a null user and then crashes deeper in at
 * createSession. An APIError is the documented way to refuse. */
export async function assertSignupAllowed(email: string) {
  if (!config.auth.disableSignup) return
  if (await getPendingInvitationForEmail(email)) return
  throw new APIError("FORBIDDEN", { message: "Sign-up is disabled" })
}
