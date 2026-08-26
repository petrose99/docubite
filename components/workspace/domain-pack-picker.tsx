"use client"

import { addDomainPackAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Button } from "@/components/ui/button"
import { useState, useTransition } from "react"

/** Turns on a hard-coded industry pack (pathology, logistics — lib/domains/) for one file, adding
 * whatever worksheets it doesn't already have. Follows the same "choose from a select, submit"
 * convention as the dictation template picker (components/dictation/new-dictation.tsx). */
export function DomainPackPicker({ workspaceId, fileId, packs }: {
  workspaceId: string
  fileId: string
  packs: Array<{ domain: string; label: string }>
}) {
  const [domain, setDomain] = useState(packs[0]?.domain ?? "")
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  if (!packs.length) return null

  const submit = () => startTransition(async () => {
    const result = await addDomainPackAction(workspaceId, fileId, domain)
    if (!result.success || !result.data) return setMessage(result.error || "Could not add that domain pack")
    setMessage(result.data.added ? `Added ${result.data.added} worksheet${result.data.added === 1 ? "" : "s"}.` : "Already added.")
  })

  return <div className="flex flex-wrap items-center gap-2 border-t pt-3">
    <select value={domain} onChange={(event) => setDomain(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" aria-label="Domain pack">
      {packs.map((pack) => <option key={pack.domain} value={pack.domain}>{pack.label}</option>)}
    </select>
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={submit}>{pending ? "Adding…" : "Add domain pack"}</Button>
    {message && <span className="text-xs text-muted-foreground">{message}</span>}
  </div>
}
