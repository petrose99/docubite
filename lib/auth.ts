import config, { isGoogleAuthEnabled } from "@/lib/config"
import { assertSignupAllowed } from "@/lib/signup-gate"
import { getUserById } from "@/models/users"
import { User } from "@/prisma/client"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "./db"
import { isEmailConfigured, resend, sendPasswordResetEmail } from "./email"

export type UserProfile = Pick<User, "id" | "name" | "email" | "avatar">

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  appName: config.app.title,
  baseURL: config.app.baseURL,
  secret: config.auth.secret,
  email: { provider: "resend", from: config.email.from, resend },
  session: { strategy: "jwt", expiresIn: 180 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 180 * 24 * 60 * 60 } },
  // Keep in lockstep with the getSessionCookie prefix in proxy.ts — a mismatch makes the proxy
  // see no session and bounce /workspaces straight back to the login page in a loop.
  advanced: { cookiePrefix: "docubite", database: { generateId: "uuid" } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // better-auth's own default is to not verify; the app has never gated on a verified address
    // and turning it on here would lock every existing account out at the next sign-in.
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      // Without a Resend key there is no way to deliver the link, and a silently dropped mail
      // makes the flow untestable. Log it instead so a dev install can complete the round trip.
      if (!isEmailConfigured()) {
        console.log(`[DEV] Password reset link for ${user.email}: ${url}`)
        return
      }
      await sendPasswordResetEmail({ email: user.email, resetUrl: url })
    },
  },
  // Registered only when both halves of the credential pair are set. An install without them
  // still boots; the login and signup pages read isGoogleAuthEnabled and omit the button.
  ...(isGoogleAuthEnabled && {
    socialProviders: {
      google: { clientId: config.auth.google.clientId, clientSecret: config.auth.google.clientSecret },
    },
  }),
  // The real sign-up gate. It runs on every path that creates a user — password sign-up and the
  // Google callback alike — rather than at any one endpoint, which is what lets an invited
  // stranger sign up while DISABLE_SIGNUP is on. See lib/signup-gate.ts for why it throws.
  databaseHooks: { user: { create: { before: async (user) => { await assertSignupAllowed(user.email) } } } },
  plugins: [nextCookies()],
})

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function getCurrentUser(): Promise<User> {
  const user = await getApiUser()
  if (user) return user
  redirect(config.auth.loginUrl)
}

/** getCurrentUser for route handlers that answer fetch() rather than a navigation. The redirect
 * that getCurrentUser issues turns an expired session into a 307 to the login page, so the
 * caller's `await response.json()` chokes on HTML instead of seeing an auth failure. Returning
 * null lets the route answer 401 JSON.
 *
 * The user is re-read from the database rather than trusted from the session: `role` is on the
 * User row, and the session cookie cache lives for 180 days, so a revoked admin would otherwise
 * keep their exemption for half a year. */
export async function getApiUser(): Promise<User | null> {
  return getViewerUser()
}

/** Resolves the signed-in User row from the session, or null — and it is where account
 * suspension is enforced.
 *
 * One check in one place is the whole point: every page, layout, server action and route handler
 * reaches the current user through this (via getApiUser or getCurrentUser), so a suspended
 * account loses all of them at once rather than one gate at a time. Sessions are JWTs here, so
 * deleting the Session rows on suspend does *not* invalidate the cookie the browser is holding —
 * this check is the real gate, and the row deletion is only hygiene.
 *
 * Exported for the handful of callers that resolve a viewer without requiring one: the shared
 * link routes and the invitation page, which have to work for signed-out visitors and so cannot
 * use getCurrentUser. They previously inlined `session?.user ? getUserById(...) : null`, which
 * would have walked straight past a suspension. */
export async function getViewerUser(): Promise<User | null> {
  const session = await getSession()
  if (!session?.user) return null
  const user = await getUserById(session.user.id)
  if (!user || user.suspendedAt) return null
  return user
}
