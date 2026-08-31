"use client"

import { updateDocumentFieldAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { AudioProvenance, AudioRef } from "@/lib/provenance-audio"
import { Check, Loader2, Play, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** Plays the moment a value was said.
 *
 * This is the audio equivalent of the PDF highlight: the reviewer does not have to believe the
 * transcript, they can hear the three seconds the value came from. A field with no chip is a field
 * nothing in the recording could be matched to — shown as such rather than left blank, because
 * "we could not find where this was said" is exactly the thing worth knowing before signing. */
function ProvenanceChip({ pin, onSeek }: { pin: AudioRef | null | undefined; onSeek: (ms: number) => void }) {
  if (!pin) {
    return <span className="text-xs text-slate-400">not pinned to the audio</span>
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(pin.startMs)}
      title={pin.quote}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800">
      <Play className="h-2.5 w-2.5 fill-current" />{clock(pin.startMs)}
      {pin.score < 0.8 && <span className="text-slate-400">approx.</span>}
    </button>
  )
}

function ConfidenceDot({ score }: { score: number | undefined }) {
  if (typeof score !== "number") return null
  const tone = score >= 0.8 ? "bg-emerald-500" : score >= 0.6 ? "bg-indigo-500" : "bg-red-500"
  return <span title={`Confidence ${Math.round(score * 100)}%`} className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
}

/** The extracted fields, each next to the audio it came from.
 *
 * Saves per field rather than as one form: a reviewer works down the list checking values against
 * the recording, and a single Save at the bottom would mean either losing that work on a stray
 * navigation or pretending a half-checked form is a reviewed one. Each save re-projects the
 * structured spine through updateDocumentFieldAction — the same path the sheet's inline edit uses. */
export function SynopticForm({
  workspaceId, documentId, fields, values, fieldConfidence, missingRequiredFields, unsupportedFields,
  provenance, readOnly, transcribing, onSeek,
}: {
  workspaceId: string
  documentId: string
  fields: DocumentFieldDefinition[]
  values: Record<string, unknown>
  fieldConfidence: Record<string, number>
  missingRequiredFields: string[]
  unsupportedFields: string[]
  provenance: AudioProvenance | null
  readOnly: boolean
  transcribing: boolean
  onSeek: (ms: number) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  const scalarFields = fields.filter((field) => field.type !== "array")
  const arrayFields = fields.filter((field) => field.type === "array")
  const missing = new Set(missingRequiredFields)
  const unsupported = new Set(unsupportedFields)

  const current = (field: DocumentFieldDefinition) => {
    if (drafts[field.key] !== undefined) return drafts[field.key]
    const value = values[field.key]
    return value === null || value === undefined ? "" : String(value)
  }

  const save = async (field: DocumentFieldDefinition) => {
    const raw = current(field).trim()
    setSavingKey(field.key)
    try {
      // Empty clears the field rather than storing "". A blank in a clinical form means "not
      // stated", and an empty string would satisfy a required-field check that ought to fail.
      const value = raw === "" ? null : field.type === "number" ? Number(raw) : field.type === "boolean" ? raw === "true" : raw
      if (field.type === "number" && raw !== "" && !Number.isFinite(value as number)) {
        toast.error(`${field.label} must be a number`)
        return
      }
      const result = await updateDocumentFieldAction(workspaceId, documentId, field.key, value)
      if (!result.success) {
        toast.error(result.error ?? "Could not save that field")
        return
      }
      setSavedKeys((keys) => new Set(keys).add(field.key))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Extracted fields</h2>
        {missing.size > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
            <TriangleAlert className="h-3 w-3" />{missing.size} required missing
          </span>
        )}
      </header>

      {transcribing ? (
        <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />Fields appear once the recording is transcribed.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {scalarFields.map((field) => {
            const pin = provenance?.fields[field.key] ?? null
            const isMissing = missing.has(field.key)
            const isUnsupported = unsupported.has(field.key)
            return (
              <div key={field.key} className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <ConfidenceDot score={fieldConfidence[field.key]} />
                  <label htmlFor={`field-${field.key}`} className="text-xs font-medium text-slate-700">
                    {field.label}
                    {field.required && <span className="ml-1 text-red-500" title="Required">*</span>}
                  </label>
                  <span className="ml-auto"><ProvenanceChip pin={pin} onSeek={onSeek} /></span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    id={`field-${field.key}`}
                    type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                    value={current(field)}
                    readOnly={readOnly}
                    placeholder={isMissing ? "Not dictated" : ""}
                    onChange={(event) => { setDrafts((state) => ({ ...state, [field.key]: event.target.value })); setSavedKeys((keys) => { const next = new Set(keys); next.delete(field.key); return next }) }}
                    onBlur={() => { if (!readOnly && drafts[field.key] !== undefined) void save(field) }}
                    className={`min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none read-only:bg-slate-50 read-only:text-slate-600 ${isMissing ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200 focus:border-emerald-400"}`} />
                  {savingKey === field.key && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />}
                  {savingKey !== field.key && savedKeys.has(field.key) && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                </div>

                {/* Two independent signals said nothing in the audio backs this value: the model
                    scored it no confidence, and it pinned to no segment. Flagged rather than
                    dropped — a visible wrong value is safer than an invisible missing one. */}
                {isUnsupported && (
                  <p className="mt-1 text-xs text-indigo-700">Nothing in the recording supports this value. Check it against the audio.</p>
                )}
              </div>
            )
          })}

          {arrayFields.map((field) => {
            const rows = Array.isArray(values[field.key]) ? (values[field.key] as Record<string, unknown>[]) : []
            const pins = provenance?.items[field.key] ?? []
            return (
              <div key={field.key} className="px-4 py-3">
                <p className="text-xs font-medium text-slate-700">{field.label}</p>
                {!rows.length && <p className="mt-1 text-sm text-slate-400">None dictated.</p>}
                {rows.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {rows.map((row, index) => (
                      <li key={index} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800">
                        <span className="min-w-0 flex-1">
                          {(field.itemFields ?? [])
                            .map((item) => row[item.key])
                            .filter((value) => value !== null && value !== undefined && value !== "")
                            .join(" · ")}
                        </span>
                        <ProvenanceChip pin={pins[index]} onSeek={onSeek} />
                      </li>
                    ))}
                  </ul>
                )}
                {/* Rows are read-only here on purpose. Editing a repeated field is a table, and a
                    half-built one next to a form people sign off from is worse than sending them to
                    the transcript, which is where a wrong marker actually came from. */}
                <p className="mt-1.5 text-xs text-slate-400">Correct these in the transcript, then save it to re-read.</p>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
