"use client"

import { authClient } from "@/lib/auth-client"
import { ChevronsUpDown, LogOut } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

/** The sidebar's account chip. Until now the app had no way out at all — there is no other
 * signOut call anywhere in the codebase — so this is the only sign-out. */
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
      await authClient.signOut()
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
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-stone-100" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{initial}</span>
      {!collapsed && <>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-stone-800">{name || email}</span>
          {name && <span className="block truncate text-xs text-stone-400">{email}</span>}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
      </>}
    </button>
    {open && <div role="menu" className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-52 overflow-hidden rounded-md border bg-white py-1 shadow-lg">
      <div className="border-b px-3 py-2">
        <p className="truncate text-sm font-medium text-stone-800">{name || email}</p>
        <p className="truncate text-xs text-stone-400">{email}</p>
      </div>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50" disabled={busy} onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" />{busy ? "Signing out…" : "Sign out"}
      </button>
    </div>}
  </div>
}
