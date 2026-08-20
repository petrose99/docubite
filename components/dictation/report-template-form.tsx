"use client"

import { updateReportTemplateAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { Button } from "@/components/ui/button"
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

type Slot = { key: string; label: string; required: boolean; unit?: string }
type Section = { key: string; title: string; instruction: string }

const move = <T,>(items: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const slugify = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "field"

const uniqueKey = (base: string, taken: Set<string>) => {
  let key = base
  let n = 2
  while (taken.has(key)) key = `${base}_${n++}`
  return key
}

/** Editing a report template.
 *
 * Labels, required flags, order and section instructions are editable on EVERY row; the KEY is
 * editable only on a row added in this session (dashed border, below) and locked once it has been
 * saved once. A key is what renderSynoptic and renderNarrative look values up by, so retyping a
 * saved one does not rename a slot — it points it at a field that does not exist, and every future
 * report renders `[missing: …]` there with nothing on screen explaining why. A brand new row has no
 * saved report depending on its key yet, so it is safe to let its key follow the label until Save. */
export function ReportTemplateForm({ workspaceId, templateId, synopticFields, narrativeSections }: {
  workspaceId: string
  templateId: string
  synopticFields: Slot[]
  narrativeSections: Section[]
}) {
  const router = useRouter()
  const [savedSlotKeys] = useState(() => new Set(synopticFields.map((slot) => slot.key)))
  const [savedSectionKeys] = useState(() => new Set(narrativeSections.map((section) => section.key)))
  const [slots, setSlots] = useState<Slot[]>(synopticFields)
  const [sections, setSections] = useState<Section[]>(narrativeSections)
  const [saving, setSaving] = useState(false)

  const addSlot = () => {
    const key = uniqueKey(slugify("new_field"), new Set(slots.map((slot) => slot.key)))
    setSlots((state) => [...state, { key, label: "New field", required: false }])
  }
  const addSection = () => {
    const key = uniqueKey(slugify("new_section"), new Set(sections.map((section) => section.key)))
    setSections((state) => [...state, { key, title: "New section", instruction: "" }])
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await updateReportTemplateAction(workspaceId, templateId, { synopticFields: slots, narrativeSections: sections })
      if (!result.success) {
        toast.error(result.error ?? "Could not save that template")
        return
      }
      toast.success("Report template saved")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="font-medium">Synoptic slots</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Rendered in this order, by code with no AI involved. A required slot with nothing dictated renders a visible
          <span className="font-mono"> [missing: …]</span> marker and is raised before signing; an optional one is dropped.
          A slot&apos;s key must match a field key the dictation actually produces, or it will always show as missing.
        </p>
        <ul className="mt-2 space-y-1">
          {slots.map((slot, index) => {
            const isNew = !savedSlotKeys.has(slot.key) && !synopticFields.some((original) => original.key === slot.key)
            return (
              <li key={index} className={`flex flex-wrap items-center gap-2 rounded border px-3 py-2 ${isNew ? "border-dashed border-emerald-300 bg-emerald-50/30" : ""}`}>
                {isNew
                  ? <input
                      value={slot.key}
                      aria-label="Slot key"
                      onChange={(event) => setSlots((state) => state.map((item, i) => i === index ? { ...item, key: slugify(event.target.value) } : item))}
                      className="w-40 shrink-0 rounded-md border border-input px-2 py-1 font-mono text-xs focus:border-emerald-400 focus:outline-none" />
                  : <span className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground" title={slot.key}>{slot.key}</span>}
                <input
                  value={slot.label}
                  aria-label={`Label for ${slot.key}`}
                  onChange={(event) => setSlots((state) => state.map((item, i) => i === index ? { ...item, label: event.target.value } : item))}
                  className="min-w-0 flex-1 rounded-md border border-input px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none" />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={slot.required}
                    onChange={(event) => setSlots((state) => state.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} />
                  required
                </label>
                <span className="flex shrink-0 gap-0.5">
                  <button type="button" aria-label={`Move ${slot.label} up`} disabled={index === 0} onClick={() => setSlots((state) => move(state, index, index - 1))} className="rounded p-1 text-muted-foreground hover:bg-stone-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={`Move ${slot.label} down`} disabled={index === slots.length - 1} onClick={() => setSlots((state) => move(state, index, index + 1))} className="rounded p-1 text-muted-foreground hover:bg-stone-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={`Remove ${slot.label}`} onClick={() => setSlots((state) => state.filter((_, i) => i !== index))} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={addSlot} className="mt-2 flex items-center gap-1 rounded-md border border-dashed border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
          <Plus className="h-3.5 w-3.5" />Add slot
        </button>
      </section>

      <section>
        <h3 className="font-medium">Narrative sections</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Written from the transcript and nothing else. The instruction is a scope limit, not a writing brief —
          a section the dictation never covered comes back as <span className="font-mono">[not dictated]</span>.
        </p>
        <ul className="mt-2 space-y-2">
          {sections.map((section, index) => {
            const isNew = !savedSectionKeys.has(section.key) && !narrativeSections.some((original) => original.key === section.key)
            return (
              <li key={index} className={`space-y-1.5 rounded border px-3 py-2 ${isNew ? "border-dashed border-emerald-300 bg-emerald-50/30" : ""}`}>
                <div className="flex items-center gap-2">
                  {isNew
                    ? <input
                        value={section.key}
                        aria-label="Section key"
                        onChange={(event) => setSections((state) => state.map((item, i) => i === index ? { ...item, key: slugify(event.target.value) } : item))}
                        className="w-40 shrink-0 rounded-md border border-input px-2 py-1 font-mono text-xs focus:border-emerald-400 focus:outline-none" />
                    : <span className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground" title={section.key}>{section.key}</span>}
                  <input
                    value={section.title}
                    aria-label={`Title for ${section.key}`}
                    onChange={(event) => setSections((state) => state.map((item, i) => i === index ? { ...item, title: event.target.value } : item))}
                    className="min-w-0 flex-1 rounded-md border border-input px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none" />
                  <span className="flex shrink-0 gap-0.5">
                    <button type="button" aria-label={`Move ${section.title} up`} disabled={index === 0} onClick={() => setSections((state) => move(state, index, index - 1))} className="rounded p-1 text-muted-foreground hover:bg-stone-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Move ${section.title} down`} disabled={index === sections.length - 1} onClick={() => setSections((state) => move(state, index, index + 1))} className="rounded p-1 text-muted-foreground hover:bg-stone-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Remove ${section.title}`} onClick={() => setSections((state) => state.filter((_, i) => i !== index))} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={section.instruction}
                  aria-label={`Instruction for ${section.key}`}
                  maxLength={500}
                  onChange={(event) => setSections((state) => state.map((item, i) => i === index ? { ...item, instruction: event.target.value } : item))}
                  className="w-full resize-y rounded-md border border-input px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none" />
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={addSection} className="mt-2 flex items-center gap-1 rounded-md border border-dashed border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
          <Plus className="h-3.5 w-3.5" />Add section
        </button>
      </section>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save template
        </Button>
        <p className="text-xs text-muted-foreground">Reports already signed are unaffected — they keep the text that was signed.</p>
      </div>
    </div>
  )
}
