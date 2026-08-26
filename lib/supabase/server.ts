import config from "@/lib/config"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/** The Supabase client for server components, server actions, and route handlers.
 *
 * The try/catch around cookies().set() is the documented shape, not defensive over-engineering:
 * a Server Component is read-only and Next throws if anything tries to write a cookie from one.
 * Middleware (proxy.ts, via lib/supabase/middleware.ts) is what actually refreshes and persists
 * the session cookie on every request; a Server Component calling setAll is just going through
 * the motions so the same factory function works in both contexts, and the catch is what makes
 * that safe when the write is a no-op. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(config.supabase.url, config.supabase.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          /* called from a Server Component — proxy.ts already refreshed the session for this request */
        }
      },
    },
  })
}

/** Admin-privileged client — service role key, bypasses RLS, never exposed to the browser.
 *
 * Used only by the two paths that need `auth.admin.*`: the bulk user-migration script and
 * prisma/seed.ts. No cookie handling — it's not tied to any one visitor's session. */
export function createAdminClient() {
  return createServerClient(config.supabase.url, config.supabase.serviceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
