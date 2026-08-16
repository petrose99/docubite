"use client"

import { createDocumentTemplateAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useState, useTransition } from "react"

const example = JSON.stringify([{ key: "reference", label: "Reference", type: "string", instruction: "Document reference", required: true }], null, 2)

export function TemplateForm({ workspaceId, files }: { workspaceId: string; files: Array<{ id: string; name: string }> }) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null)
  return <form action={(formData) => startTransition(async () => { const result = await createDocumentTemplateAction(workspaceId, formData); setError(result.success ? null : result.error || "Could not save template") })} className="space-y-3"><select name="fileId" aria-label="File" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" required>{files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select><Input name="name" placeholder="Template name" required /><Input name="code" placeholder="stable_key" pattern="[a-z][a-z0-9_]{1,62}" required /><Textarea name="fields" defaultValue={example} className="min-h-48 font-mono text-xs" required /><Textarea name="prompt" placeholder="Optional extraction guidance" /><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create template"}</Button>{error && <p className="text-sm text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Keys cannot be renamed or removed after documents use a template. Supported types: string, number, date, boolean, array, enum.</p></form>
}
