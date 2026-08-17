"use client"

import { undoAiFieldEditAction } from "@/app/(app)/workspaces/[workspaceId]/data-actions"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { ArrowUp, ChevronDown, CircleCheck, ExternalLink, Loader2, RotateCcw, Search, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

const INTENTS = [
  "What did we spend by vendor?",
  "Which documents are missing required values?",
  "List invoices with a total over 1000",
]

const TOOL_LABELS: Record<string, string> = {
  search_documents: "Searching documents",
  get_document_values: "Reading a document",
  get_document_text: "Reading document text",
  aggregate_values: "Calculating",
  update_field_value: "Editing a value",
}

type Change = { documentId: string; filename?: string; fieldKey: string; previousValue?: unknown; newValue?: unknown }

/** Cross-document AI assistant, docked to the right of the /data browser. Unlike the sheet
 * assistant, its tools run server-side and stream their own results, so there is no client tool
 * loop here — the panel only renders the conversation and offers per-change Undo. */
export function DataChatPanel({ workspaceId, aiEnabled, onClose }: {
  workspaceId: string
  aiEnabled: boolean
  onClose: () => void
}) {
  const [input, setInput] = useState("")
  const scroller = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/data-chat", body: { workspaceId } }),
  })

  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])

  const ask = (text: string) => {
    const question = text.trim()
    if (!question || busy || !aiEnabled) return
    setInput("")
    void sendMessage({ text: question })
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l bg-stone-50">
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2">
        <Sparkles className="h-4 w-4 text-emerald-700" />
        <span className="text-sm font-semibold text-stone-800">AI Assistant</span>
        <button type="button" aria-label="Close AI Assistant" className="ml-auto rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!aiEnabled && <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">The AI assistant is turned off for this workspace.</p>}

        {aiEnabled && !messages.length && (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">Ask about the data extracted across every document in this workspace. The assistant can search, total, and correct values.</p>
            {INTENTS.map((intent) => (
              <button key={intent} type="button" className="block w-full rounded-md border bg-white px-2.5 py-2 text-left text-xs text-stone-600 hover:border-emerald-300 hover:text-stone-900" onClick={() => ask(intent)}>
                {intent}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-6 rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white" : "space-y-1.5 text-sm text-stone-800"}>
            {message.parts.map((part, index) => {
              if (part.type === "text") return <p key={index} className="whitespace-pre-wrap">{part.text}</p>
              if (part.type === "reasoning") return <Thought key={index} text={part.text} />
              if (part.type === "tool-task_complete") {
                const input = (part as { input?: { summary?: string; changes?: Change[] } }).input
                return input?.summary ? <ChangesCard key={index} workspaceId={workspaceId} summary={input.summary} changes={input.changes ?? []} /> : null
              }
              if (part.type.startsWith("tool-")) {
                const name = part.type.slice("tool-".length)
                if (name === "task_complete") return null
                return <p key={index} className="flex items-center gap-1.5 text-xs text-stone-500"><Search className="h-3 w-3" />{TOOL_LABELS[name] ?? name}</p>
              }
              return null
            })}
          </div>
        ))}

        {busy && <p className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="h-3 w-3 animate-spin" />Thinking…</p>}
        {error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error.message}</p>}
      </div>

      <form
        className="flex items-end gap-1.5 border-t bg-white p-2"
        onSubmit={(event) => { event.preventDefault(); ask(input) }}>
        <textarea
          rows={2}
          value={input}
          placeholder={aiEnabled ? "Ask anything…" : "AI is turned off"}
          disabled={!aiEnabled}
          className="min-w-0 flex-1 resize-none rounded-md border border-stone-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none disabled:bg-stone-100"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input) }
          }} />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim() || !aiEnabled} className="rounded-md bg-emerald-700 p-2 text-white disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </aside>
  )
}

const displayValue = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value))

/** What the assistant changed, with a link to each document's review page and a per-change Undo.
 * The previous value travels in the tool result, so Undo needs no server session — it is a normal
 * audited edit back to that value. */
function ChangesCard({ workspaceId, summary, changes }: { workspaceId: string; summary: string; changes: Change[] }) {
  const router = useRouter()
  const [undone, setUndone] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)

  const undo = async (index: number, change: Change) => {
    setBusy(index)
    try {
      const result = await undoAiFieldEditAction(workspaceId, change.documentId, change.fieldKey, change.previousValue ?? null)
      if (!result.success) { toast.error(result.error || "Could not undo"); return }
      setUndone((previous) => new Set(previous).add(index))
      toast.success("Change undone")
      router.refresh()
    } catch { toast.error("Could not reach the server") } finally { setBusy(null) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <p className="flex items-start gap-1.5 text-sm text-emerald-900">
        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span>{summary}</span>
      </p>
      {changes.length > 0 && (
        <ul className="space-y-1.5">
          {changes.map((change, index) => (
            <li key={index} className="rounded-md bg-white px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/workspaces/${workspaceId}/documents/${change.documentId}`} className="inline-flex items-center gap-1 font-medium text-stone-700 hover:text-emerald-800">
                  <ExternalLink className="h-3 w-3" />
                  <span className="max-w-[10rem] truncate">{change.filename || "document"}</span>
                </Link>
                <button type="button" disabled={undone.has(index) || busy === index} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                  onClick={() => void undo(index, change)}>
                  {busy === index ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}{undone.has(index) ? "Undone" : "Undo"}
                </button>
              </div>
              <div className="mt-1 text-stone-500">
                <span className="font-mono text-stone-600">{change.fieldKey}</span>: <span className="line-through">{displayValue(change.previousValue)}</span> → <span className="font-semibold text-stone-800">{displayValue(change.newValue)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Collapsed model reasoning, kept out of the way. */
function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md bg-stone-100 px-2 py-1.5">
      <button type="button" className="flex w-full items-center gap-1 text-xs font-medium text-stone-500" onClick={() => setOpen((value) => !value)}>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />Thought
      </button>
      {open && <p className="mt-1 whitespace-pre-wrap text-xs text-stone-500">{text}</p>}
    </div>
  )
}
