"use client"

import { getFileSharingAction, setFileLinkAccessAction, shareFileAction, unshareFileAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Dialog } from "@/components/ui/dialog"
import { Check, Copy, Globe, Loader2, Lock, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

/** Lido's four levels, in their words. "Can interact" is the subtle one: the viewer gets a
 * working grid whose edits are never sent to the server (see components/extract/read-only-grid). */
export const LINK_ACCESS_OPTIONS = [
  { value: "none", label: "No access", hint: "Only people you invite can open this file" },
  { value: "view", label: "Can view", hint: "Anyone with the link can read the data" },
  { value: "interact", label: "Can interact", hint: "Anyone with the link can edit locally; changes are not saved to your file" },
  { value: "edit", label: "Can edit", hint: "Anyone with the link can change your file" },
] as const

const PERSON_ACCESS_OPTIONS = LINK_ACCESS_OPTIONS.filter((option) => option.value !== "none")

type Sharing = { linkAccess: string; shareUrl: string; people: Array<{ email: string; access: string }>; hipaaMode: boolean }

export function ShareDialog({ workspaceId, fileId, fileName, open, onClose }: {
  workspaceId: string
  fileId: string
  fileName: string
  open: boolean
  onClose: () => void
}) {
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [inviteAccess, setInviteAccess] = useState("view")
  const [inviting, setInviting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Reset on open/close as derived state rather than inside the effect, so opening the dialog
  // does not cost a cascading render before the fetch even starts.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setSharing(null)
    setEmail("")
    setCopied(false)
    setLoading(open)
  }

  useEffect(() => {
    if (!open) return
    let live = true
    void getFileSharingAction(workspaceId, fileId)
      .then((result) => { if (live) { if (result.success && result.data) setSharing(result.data); else toast.error(result.error || "Could not load sharing") } })
      .catch(() => { if (live) toast.error("Could not reach the server") })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, workspaceId, fileId])

  const changeLinkAccess = async (access: string) => {
    const previous = sharing
    setSharing((current) => (current ? { ...current, linkAccess: access } : current))
    const result = await setFileLinkAccessAction(workspaceId, fileId, access).catch(() => null)
    if (!result?.success) {
      setSharing(previous)
      toast.error(result?.error || "Could not change link access")
      return
    }
    toast.success(LINK_ACCESS_OPTIONS.find((option) => option.value === access)?.label || "Link access updated")
  }

  const invite = async () => {
    if (!email.trim()) return
    setInviting(true)
    try {
      const result = await shareFileAction(workspaceId, fileId, email, inviteAccess)
      if (!result.success || !result.data) return void toast.error(result.error || "Could not share the file")
      const added = result.data
      setSharing((current) => (current ? { ...current, people: [...current.people.filter((person) => person.email !== added.email), added] } : current))
      setEmail("")
      toast.success(`${added.email} can now ${added.access === "edit" ? "edit" : added.access === "interact" ? "interact with" : "view"} this file`)
    } catch {
      toast.error("Could not reach the server")
    } finally { setInviting(false) }
  }

  const remove = async (personEmail: string) => {
    const previous = sharing
    setSharing((current) => (current ? { ...current, people: current.people.filter((person) => person.email !== personEmail) } : current))
    const result = await unshareFileAction(workspaceId, fileId, personEmail).catch(() => null)
    if (!result?.success) { setSharing(previous); toast.error(result?.error || "Could not remove access") }
  }

  const changePersonAccess = async (personEmail: string, access: string) => {
    setSharing((current) => (current ? { ...current, people: current.people.map((person) => (person.email === personEmail ? { ...person, access } : person)) } : current))
    const result = await shareFileAction(workspaceId, fileId, personEmail, access).catch(() => null)
    if (!result?.success) toast.error(result?.error || "Could not change access")
  }

  const copyLink = async () => {
    if (!sharing) return
    try {
      await navigator.clipboard.writeText(sharing.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { toast.error("Could not copy the link") }
  }

  const selected = LINK_ACCESS_OPTIONS.find((option) => option.value === sharing?.linkAccess) || LINK_ACCESS_OPTIONS[0]
  const inputClass = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

  return <Dialog open={open} onClose={onClose} title={`Share "${fileName}"`} width="max-w-lg">
    {loading || !sharing
      ? <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-stone-400"><Loader2 className="h-4 w-4 animate-spin" />Loading sharing…</div>
      : <div className="divide-y">
          <section className="space-y-3 px-5 py-4">
            <h3 className="text-sm font-semibold text-stone-900">People with access</h3>
            <div className="flex gap-2">
              <input className={inputClass} type="email" placeholder="Add people by email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void invite() } }} />
              <select aria-label="Access for the invited person" className="shrink-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={inviteAccess} onChange={(event) => setInviteAccess(event.target.value)}>
                {PERSON_ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button type="button" className="shrink-0 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={inviting || !email.trim()} onClick={() => void invite()}>
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
              </button>
            </div>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 rounded px-1 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-stone-700">Everyone in this workspace</span>
                <span className="shrink-0 text-xs font-medium text-stone-400">Owner</span>
              </li>
              {sharing.people.map((person) => <li key={person.email} className="flex items-center gap-2 rounded px-1 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate text-stone-700" title={person.email}>{person.email}</span>
                <select aria-label={`Access for ${person.email}`} className="shrink-0 rounded border border-stone-200 px-1.5 py-1 text-xs" value={person.access} onChange={(event) => void changePersonAccess(person.email, event.target.value)}>
                  {PERSON_ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button type="button" className="shrink-0 rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600" title={`Remove ${person.email}`} onClick={() => void remove(person.email)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>)}
            </ul>
          </section>

          <section className="space-y-2 px-5 py-4">
            <h3 className="text-sm font-semibold text-stone-900">General access</h3>
            {sharing.hipaaMode
              ? <div className="flex items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  Link sharing is off for this workspace (HIPAA mode). Only people you invite by email can open this file.
                </div>
              : <>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${sharing.linkAccess === "none" ? "bg-stone-100 text-stone-500" : "bg-emerald-100 text-emerald-700"}`}>
                      {sharing.linkAccess === "none" ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                    </span>
                    <select aria-label="General access" className="rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={sharing.linkAccess} onChange={(event) => void changeLinkAccess(event.target.value)}>
                      {LINK_ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-stone-500">{selected.hint}</p>
                  {sharing.linkAccess !== "none" && <div className="flex items-center gap-2 pt-1">
                    <input readOnly aria-label="Share link" className={`${inputClass} bg-stone-50 text-stone-500`} value={sharing.shareUrl} onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" onClick={() => void copyLink()}>
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
                    </button>
                  </div>}
                </>}
          </section>
        </div>}
  </Dialog>
}
