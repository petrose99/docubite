"use client"

import { createBrowserClient } from "@supabase/ssr"

/** The Supabase client for client components — replaces `authClient` from lib/auth-client.ts.
 *
 * Reads process.env.NEXT_PUBLIC_SUPABASE_URL/ANON_KEY directly rather than through lib/config.ts's
 * `config` object: Next.js only inlines a NEXT_PUBLIC_ variable into the browser bundle when it
 * sees a literal `process.env.NEXT_PUBLIC_X` reference at build time, and that static analysis
 * does not follow through a re-exported object from another module. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}
