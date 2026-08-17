"use client"

import { deleteLibraryTemplateAction, saveTemplateToLibraryAction, updateLibraryTemplateAction, type LibraryTemplate } from "@/app/(app)/workspaces/[workspaceId]/template-actions"
import { ColumnChips } from "@/components/extract/column-chips"
import { FieldChips } from "@/components/extract/library-controls"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { parseTemplateFields, type DocumentFieldDefinition } from "@/lib/document-templates"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

const inputClass = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

type Draft = {
  id: string | null
  name: string
  description: string
  prompt: string
  multiRow: boolean
  fields: DocumentFieldDefinition[]
}

const emptyDraft = (): Draft => ({ id: null, name: "", description: "", prompt: "", multiRow: true, fields: [] })

const toDraft = (template: LibraryTemplate): Draft => {
  let fields: DocumentFieldDefinition[] = []
  try {
    fields = parseTemplateFields(template.fields)
  } catch {
    fields = []
  }
  return { id: template.id, name: template.name, description: template.description ?? "", prompt: template.prompt ?? "", multiRow: template.multiRow, fields }
}

/** The workspace template library on the Templates settings page: a card per reusable template,
 * with create/edit (columns via the shared ColumnChips editor) and delete. Owner-gated writes. */
export function LibraryManager({ workspaceId, templates, canManage }: {
  workspaceId: string
  templates: LibraryTemplate[]
  canManage: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<LibraryTemplate | null>(null)

  const patch = (changes: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...changes } : current))

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.fields.length) return
    setBusy(true)
    try {
      const input = { name: draft.name.trim(), description: draft.description, prompt: draft.prompt, multiRow: draft.multiRow, fields: draft.fields }
      const result = draft.id
        ? await updateLibraryTemplateAction(workspaceId, draft.id, input)
        : await saveTemplateToLibraryAction(workspaceId, input)
      if (!result.success) { toast.error(result.error || "Could not save"); return }
      toast.success(draft.id ? "Template updated" : "Template created")
      setDraft(null)
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirming) return
    setBusy(true)
    try {
      const result = await deleteLibraryTemplateAction(workspaceId, confirming.id)
      if (!result.success) { toast.error(result.error || "Could not delete"); return }
      toast.success("Template deleted")
      setConfirming(null)
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  return <div className="space-y-3">
    {canManage && <div className="flex justify-end">
      <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800" onClick={() => setDraft(emptyDraft())}>
        <Plus className="h-4 w-4" />New template
      </button>
    </div>}

    {templates.length === 0 && <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-stone-400">
      No saved templates yet. Save one from a file&apos;s columns, or create one here to reuse across files.
    </p>}

    <div className="grid gap-3 sm:grid-cols-2">
      {templates.map((template) => <div key={template.id} className="rounded-lg border bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-stone-800">{template.name}</p>
            {template.description && <p className="mt-0.5 text-xs text-stone-500">{template.description}</p>}
          </div>
          {canManage && <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Edit" className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={() => setDraft(toDraft(template))}><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Delete" className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600" onClick={() => setConfirming(template)}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>}
        </div>
        <FieldChips fields={template.fields} />
        <p className="mt-2 text-[11px] text-stone-400">{template.multiRow ? "Multiple rows per document" : "One row per document"} · used {template.useCount}×</p>
      </div>)}
    </div>

    <Dialog open={draft !== null} onClose={() => setDraft(null)} width="max-w-lg" title={draft?.id ? "Edit template" : "New template"} description="Define the columns to extract. Applying this later copies them into a file's worksheet.">
      {draft && <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Name</label>
          <input autoFocus className={inputClass} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Description (optional)</label>
          <input className={inputClass} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Columns</label>
          <ColumnChips fields={draft.fields} onChange={(fields) => patch({ fields })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Extra instructions (optional)</label>
          <textarea className={inputClass} rows={3} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-700">
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={draft.multiRow} onChange={(event) => patch({ multiRow: event.target.checked })} />
          Extract multiple rows per document
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" onClick={() => setDraft(null)}>Cancel</button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy || !draft.name.trim() || !draft.fields.length} onClick={() => void save()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{draft.id ? "Save changes" : "Create"}
          </button>
        </div>
      </div>}
    </Dialog>

    <ConfirmDialog
      open={confirming !== null}
      destructive
      busy={busy}
      title={`Delete "${confirming?.name}"?`}
      description="This removes the library template. Files already created from it are not affected."
      confirmLabel={busy ? "Deleting…" : "Delete"}
      onConfirm={() => void remove()}
      onCancel={() => setConfirming(null)} />
  </div>
}
