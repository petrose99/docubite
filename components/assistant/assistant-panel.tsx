"use client"

import { DocumentSearchPart, type SourceHit } from "@/components/assistant/document-sources"
import { PendingChangesBar } from "@/components/assistant/pending-changes-bar"
import { PendingChanges } from "@/components/assistant/pending-changes"
import { focusRange, runSheetTool, SHEET_TOOL_NAMES, WRITE_TOOLS } from "@/components/assistant/sheet-tools"
import type { FUniver } from "@univerjs/presets"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { ArrowUp, ChevronDown, CircleCheck, Loader2, Sparkles, Table2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

/** Lido opens its assistant with a few starting points rather than a blank box, because the
 * useful questions are not obvious until you have seen one. */
const INTENTS = [
  "What is the total of each numeric column?",
  "Which rows are missing required values?",
  "Add a column totalling each row",
]

/** Offered only when document search is on — one, not two: four buttons is the ceiling. Leads the
 * user to the half of the assistant they would not otherwise discover (the documents, not the grid). */
const DOCUMENT_INTENT = "What payment terms do the invoices state?"

const TOOL_LABELS: Record<string, string> = {
  profile_workbook: "Reading the workbook",
  read_range: "Reading data",
  select_range: "Selecting cells",
  write_cells: "Writing cells",
  write_range: "Writing data",
  add_column: "Adding a column",
  search_documents: "Searching documents",
}

/** The AI assistant, docked to the left of the grid.
 *
 * Tool calls are executed here in the browser (see sheet-tools.ts) and the results posted back,
 * so the assistant answers from the workbook on screen rather than from the saved snapshot. */
export function AssistantPanel({ workspaceId, apiRef, onClose, documentSearchEnabled = false, onOpenSource }: {
  workspaceId: string
  /** The live grid. A ref rather than a value because the panel mounts before Univer finishes
   * booting, and a question asked in that window still has to find a workbook to read. */
  apiRef: RefObject<FUniver | null>
  onClose: () => void
  /** Additive and default-off: callers that do not pass these see today's behaviour exactly. When
   * on, the empty state gains a document intent and the search tool renders its Sources card. */
  documentSearchEnabled?: boolean
  onOpenSource?: (hit: SourceHit) => void
}) {
  const [input, setInput] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  // Pre-images of everything the assistant has written and the user has not yet ruled on. Held
  // outside React state because the tools write to it synchronously while a tool call runs; the
  // count below is only the part the bar needs to re-render on.
  const pending = useMemo(() => new PendingChanges(), [])
  const [pendingCount, setPendingCount] = useState(0)

  const { messages, sendMessage, addToolResult, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai-chat", body: { workspaceId } }),
    // Without this the loop stops dead after the first tool call: the browser runs the tool and
    // records the result, but nothing sends it back, so the model never gets to answer.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      // Server-executed tools (search_documents) return through the stream. Running them here would
      // stamp an "Unknown tool" result over the real one, so only the browser-run tools are handled.
      if (!SHEET_TOOL_NAMES.has(toolCall.toolName)) return
      const api = apiRef.current
      const output = api
        ? runSheetTool(api, pending, toolCall.toolName, toolCall.input)
        : { error: "The spreadsheet is still loading; ask again in a moment." }
      if (WRITE_TOOLS.has(toolCall.toolName)) setPendingCount(pending.size)
      addToolResult({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output })
    },
  })

  const busy = status === "submitted" || status === "streaming"

  const settle = (action: "undo" | "accept") => {
    const api = apiRef.current
    if (!api) return
    if (action === "undo") pending.undo(api)
    else pending.accept(api)
    setPendingCount(0)
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])

  const ask = (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    setInput("")
    void sendMessage({ text: question })
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r bg-stone-50">
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2">
        <Sparkles className="h-4 w-4 text-emerald-700" />
        <span className="text-sm font-semibold text-stone-800">AI Assistant</span>
        <button type="button" aria-label="Close AI Assistant" className="ml-auto rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">
              {documentSearchEnabled
                ? "Ask about the data in this sheet — or what the documents behind it actually say."
                : "Ask about the data in this sheet. The assistant reads the grid as you see it."}
            </p>
            {(documentSearchEnabled ? [...INTENTS, DOCUMENT_INTENT] : INTENTS).map((intent) => (
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
              // Tool parts are typed as `tool-<name>`; showing them is what makes the wait
              // legible — otherwise several seconds pass with nothing on screen.
              if (part.type === "tool-task_complete") {
                const input = (part as { input?: { summary?: string; changes?: { target?: string; action?: string }[] } }).input
                return input?.summary ? <SummaryCard key={index} summary={input.summary} changes={input.changes ?? []} apiRef={apiRef} /> : null
              }
              // The document-search tool runs on the server, so its result arrives through the
              // stream with the full part state; it gets its own renderer (Sources card, snippets,
              // click-through) rather than the one-line generic fallback below.
              if (part.type === "tool-search_documents") {
                const p = part as { state: "input-streaming" | "input-available" | "output-available" | "output-error"; input?: { query?: unknown }; output?: { results?: unknown; error?: unknown; pendingIndexing?: unknown } }
                return <DocumentSearchPart key={index} state={p.state} input={p.input} output={p.output} onOpenSource={onOpenSource} />
              }
              if (part.type.startsWith("tool-")) {
                const name = part.type.slice("tool-".length)
                return <p key={index} className="flex items-center gap-1.5 text-xs text-stone-500"><Table2 className="h-3 w-3" />{TOOL_LABELS[name] ?? name}</p>
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
          placeholder="Ask anything…"
          className="min-w-0 flex-1 resize-none rounded-md border border-stone-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input) }
          }} />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="rounded-md bg-emerald-700 p-2 text-white disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>

      <PendingChangesBar count={pendingCount} busy={busy} onUndo={() => settle("undo")} onAccept={() => settle("accept")} />
    </aside>
  )
}

/** What the assistant says it did, with every cell it names clickable.
 *
 * The point of the references is verification: a claim of "filled in the missing totals" is
 * worth little on its own, and worth a great deal when each one jumps the selection to the cell
 * so the user can look at it. */
function SummaryCard({ summary, changes, apiRef }: {
  summary: string
  changes: { target?: string; action?: string }[]
  apiRef: RefObject<FUniver | null>
}) {
  const jump = (target: string) => {
    const api = apiRef.current
    const workbook = api?.getActiveWorkbook()
    if (!workbook) return
    // Targets arrive as "Sheet1!G1" or bare "G1" — the sheet half is optional and the model is
    // not consistent about it.
    const [sheetName, range] = target.includes("!") ? target.split("!") : [null, target]
    const sheet = sheetName ? workbook.getSheets().find((candidate) => candidate.getSheetName() === sheetName) : workbook.getActiveSheet()
    if (!sheet) return
    try {
      focusRange(sheet, range)
    } catch {
      // A reference the model invented rather than wrote to. Nothing to jump to; the summary
      // text still stands.
    }
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <p className="flex items-start gap-1.5 text-sm text-emerald-900">
        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span>{summary}</span>
      </p>
      {changes.length > 0 && (
        <ul className="space-y-0.5 pl-5">
          {changes.map((change, index) => (
            <li key={index} className="text-xs text-emerald-800">
              {change.target && (
                <button type="button" className="font-mono font-semibold underline underline-offset-2 hover:text-emerald-950" onClick={() => jump(change.target as string)}>
                  {change.target}
                </button>
              )}
              {change.action ? <span className="ml-1.5">{change.action}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Gemini's thinking, collapsed. It is long, it is not the answer, and it is occasionally the
 * only thing that explains a wrong one — so it is kept, but out of the way. */
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
