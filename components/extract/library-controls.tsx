"use client"

import { listLibraryTemplatesAction, markLibraryTemplateUsedAction, saveTemplateToLibraryAction, type LibraryTemplate } from "@/app/(app)/workspaces/[workspaceId]/template-actions"
import { Dialog } from "@/components/ui/dialog"
import { parseTemplateFields, type DocumentFieldDefinition } from "@/lib/document-templates"
import { BookMarked, Library, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

export type AppliedTemplate = { name: string; fields: DocumentFieldDefinition[]; prompt: string; multiRow: boolean }

const inputClass = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

/** "Save to library": stores the panel's current columns/prompt/multiRow as a reusable workspace
 * template. Enabled only when there is at least one column. */
export function SaveToLibraryButton({ workspaceId, name, fields, prompt, multiRow }: {
  workspaceId: string
  name: string
  fields: DocumentFieldDefinition[]
  prompt: string
  multiRow: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const openDialog = () => { setDraftName(name); setDescription(""); setOpen(true) }

  const save = async () => {
    if (!draftName.trim()) return
    setBusy(true)
    try {
      const result = await saveTemplateToLibraryAction(workspaceId, { name: draftName.trim(), description, fields, prompt, multiRow })
      if (!result.success) { toast.error(result.error || "Could not save the template"); return }
      toast.success("Saved to template library")
      setOpen(false)
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  return <>
    <button type="button" disabled={!fields.length} title={fields.length ? "Save these columns as a reusable template" : "Add a column first"}
      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
      onClick={openDialog}>
      <BookMarked className="h-3.5 w-3.5" />Save to library
    </button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Save to template library" description="Reuse these columns to start new files later.">
      <div className="space-y-3 px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Template name</label>
          <input autoFocus className={inputClass} value={draftName} onChange={(event) => setDraftName(event.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Description (optional)</label>
          <input className={inputClass} placeholder="What is this template for?" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <p className="text-xs text-stone-400">{fields.length} column{fields.length === 1 ? "" : "s"} · {multiRow ? "multiple rows per document" : "one row per document"}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy || !draftName.trim()} onClick={() => void save()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save
          </button>
        </div>
      </div>
    </Dialog>
  </>
}

/** "Start from a saved template": picks a library entry and loads its columns/prompt/multiRow into
 * the panel — copy-on-apply, so later edits to the library never touch the created worksheet. */
export function StartFromLibraryButton({ workspaceId, onApply, variant = "chip" }: {
  workspaceId: string
  onApply: (template: AppliedTemplate) => void
  variant?: "chip" | "link"
}) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<LibraryTemplate[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setOpen(true)
    setLoading(true)
    try {
      const result = await listLibraryTemplatesAction(workspaceId)
      if (!result.success || !result.data) { toast.error(result.error || "Could not load templates"); setTemplates([]); return }
      setTemplates(result.data)
    } catch { toast.error("Could not reach the server"); setTemplates([]) } finally { setLoading(false) }
  }

  const apply = (template: LibraryTemplate) => {
    let fields: DocumentFieldDefinition[]
    try {
      fields = parseTemplateFields(template.fields)
    } catch {
      toast.error("This template's columns could not be read")
      return
    }
    onApply({ name: template.name, fields, prompt: template.prompt ?? "", multiRow: template.multiRow })
    void markLibraryTemplateUsedAction(workspaceId, template.id)
    setOpen(false)
  }

  const trigger = variant === "link"
    ? <button type="button" className="rounded-md px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100" onClick={() => void load()}>Start from a saved template</button>
    : <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100" onClick={() => void load()}><Library className="h-3.5 w-3.5" />Start from a saved template</button>

  return <>
    {trigger}
    <Dialog open={open} onClose={() => setOpen(false)} title="Start from a saved template" description="Load a template library entry's columns into this file.">
      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
        {loading && <p className="flex items-center gap-1.5 text-sm text-stone-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
        {!loading && templates && templates.length === 0 && <p className="py-6 text-center text-sm text-stone-400">No saved templates yet. Save one from any file&apos;s columns to reuse it here.</p>}
        {!loading && templates?.map((template) => <button key={template.id} type="button" onClick={() => apply(template)}
          className="block w-full rounded-md border px-3 py-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50/50">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-stone-800">{template.name}</span>
            <span className="text-xs text-stone-400">used {template.useCount}×</span>
          </div>
          {template.description && <p className="mt-0.5 text-xs text-stone-500">{template.description}</p>}
          <FieldChips fields={template.fields} />
        </button>)}
      </div>
    </Dialog>
  </>
}

/** Small preview of a template's columns as chips. Tolerates a malformed snapshot silently. */
export function FieldChips({ fields }: { fields: unknown }) {
  let parsed: DocumentFieldDefinition[]
  try {
    parsed = parseTemplateFields(fields)
  } catch {
    return null
  }
  return <div className="mt-1.5 flex flex-wrap gap-1">
    {parsed.slice(0, 8).map((field) => <span key={field.key} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">{field.label}</span>)}
    {parsed.length > 8 && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-400">+{parsed.length - 8}</span>}
  </div>
}
