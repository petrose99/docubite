import config from "@/lib/config"
import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

/** Refreshes the Supabase session for one request and returns both the (possibly-rewritten)
 * response carrying the refreshed cookies and the authenticated user, if any.
 *
 * `supabase.auth.getUser()` is called immediately after the client is constructed, with nothing
 * in between — Supabase's own migration guide is explicit that inserting logic there causes
 * hard-to-debug random logouts, because it is the getUser() call itself that triggers the token
 * refresh whose result setAll below needs to persist. Every caller MUST return the `response` this
 * returns (or a NextResponse built from it), never a bare NextResponse.next() — that would drop
 * the refreshed cookies and the browser would keep sending an expired token. */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(config.supabase.url, config.supabase.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  return { response, userId: user?.id ?? null }
}
