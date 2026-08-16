"use client"

import { authClient } from "@/lib/auth-client"
import { useState } from "react"

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="h-4 w-4">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

/** Rendered only where the server has told the page that Google is configured — see
 * isGoogleAuthEnabled in lib/config.ts. Without both credentials better-auth never registers the
 * provider, and this button would send people to a 404. */
export function GoogleButton({ callbackURL = "/workspaces", label = "Continue with Google", onError }: {
  callbackURL?: string
  label?: string
  onError?: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    onError?.("")
    try {
      // Resolves into a redirect to Google, so there is no success path to handle here — only
      // the failure to start it, in which case the button has to become usable again.
      await authClient.signIn.social({ provider: "google", callbackURL })
    } catch {
      onError?.("Could not reach Google just now. Please try again.")
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={busy}
      className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-stone-300 bg-white text-sm font-semibold text-stone-800 shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      <GoogleGlyph />{busy ? "Redirecting…" : label}
    </button>
  )
}
