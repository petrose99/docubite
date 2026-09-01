"use client"

import { Button } from "@/components/ui/button"
import { reportAuthEvent } from "@/lib/auth-audit-client"
import { createClient } from "@/lib/supabase/client"
import { useState } from "react"
import { toast } from "sonner"

/** Offered on the invitation page when the signed-in account is not the invited address: the
 * only way forward is to become someone else. Hard navigation for the same reason as the
 * sidebar's sign-out — the session cookie is gone and every cached server render with it. */
export function SignOutButton({ label = "Sign out", redirectTo = "/login" }: { label?: string; redirectTo?: string }) {
  const [busy, setBusy] = useState(false)
  return <Button type="button" variant="outline" disabled={busy} onClick={async () => {
    setBusy(true)
    try {
      // Reported before signOut(), not after: the session that attributes this event to an actor
      // is still valid here and gone the moment signOut() resolves.
      reportAuthEvent("auth_logout")
      await createClient().auth.signOut()
      window.location.href = redirectTo
    } catch {
      toast.error("Could not sign out — please try again")
      setBusy(false)
    }
  }}>{busy ? "Signing out…" : label}</Button>
}
