"use client"

import { createClient } from "@/lib/supabase/client"
import { useState } from "react"
import { toast } from "sonner"

/** F13: ends every session on the account, not just this one — supabase.auth.signOut({ scope:
 * 'global' }) revokes every refresh token for the user, so a browser signed in elsewhere is
 * logged out on its next request. This browser included: it also clears the local session, same
 * as the sidebar's ordinary sign-out, so the redirect afterward is unconditional. */
export function SignOutEverywhereButton() {
  const [busy, setBusy] = useState(false)
  return <button
    type="button"
    className="rounded-md border px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
    disabled={busy}
    onClick={async () => {
      setBusy(true)
      try {
        const { error } = await createClient().auth.signOut({ scope: "global" })
        if (error) { toast.error("Could not sign out everywhere"); setBusy(false); return }
        window.location.href = "/login"
      } catch {
        toast.error("Could not reach the server")
        setBusy(false)
      }
    }}
  >
    {busy ? "Signing out…" : "Sign out everywhere"}
  </button>
}
