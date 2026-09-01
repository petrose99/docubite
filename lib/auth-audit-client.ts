"use client"

/** Fire-and-forget client-side call to app/api/internal/auth/audit/route.ts — reports an auth
 * event the server has no visibility into (the Supabase SDK calls run entirely in the browser).
 * Never awaited by callers and never throws: an audit report must not be able to block or fail
 * the sign-in/out/MFA flow it is describing. */
export function reportAuthEvent(type: string, detail?: Record<string, string>) {
  fetch("/api/internal/auth/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, detail }),
    keepalive: true,
  }).catch(() => {})
}
