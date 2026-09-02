"use client"

import { reportAuthEvent } from "@/lib/auth-audit-client"
import { createClient } from "@/lib/supabase/client"
import { ChevronsUpDown, LogOut } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

/** The sidebar's account chip and its sign-out control — the everyday one, scoped to this
 * session only. "Sign out everywhere" (F13, terminates every session on the account) lives on
 * /settings/security instead, since it's a rarer, more consequential action. */
export function AccountMenu({ name, email, collapsed = false }: { name: string; email: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("mousedown", onPointerDown); window.removeEventListener("keydown", onKeyDown) }
  }, [open])

  const signOut = async () => {
    setBusy(true)
    try {
      // Reported before signOut(), not after: the session that attributes this event to an actor
      // is still valid here and gone the moment signOut() resolves.
      reportAuthEvent("auth_logout")
      await createClient().auth.signOut()
      // A full navigation rather than router.push: the session cookie is gone, so every
      // cached server component for this user has to be dropped too.
      window.location.href = "/login"
    } catch {
      toast.error("Could not sign out — please try again")
      setBusy(false)
    }
  }

  const initial = (name || email).trim().charAt(0).toUpperCase() || "?"

  return <div ref={wrapper} className="relative">
    <button type="button" className="flex w-full items-center gap-2 border border-transparent rounded-[11px] px-2 py-2 text-left transition-all hover:border-[#dbe3ea] hover:bg-white hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-emerald-700 text-xs font-bold text-white">{initial}</span>
      {!collapsed && <>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">{name || email}</span>
          {name && <span className="block truncate text-xs text-slate-400">{email}</span>}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </>}
    </button>
    {open && <div role="menu" className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-52 overflow-hidden rounded-md border bg-white py-1 shadow-lg">
      <div className="border-b px-3 py-2">
        <p className="truncate text-sm font-medium text-slate-800">{name || email}</p>
        <p className="truncate text-xs text-slate-400">{email}</p>
      </div>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50" disabled={busy} onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" />{busy ? "Signing out…" : "Sign out"}
      </button>
    </div>}
  </div>
}
