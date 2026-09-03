"use client"

import { DocumentSearchPart, type SourceHit } from "@/components/assistant/document-sources"
import { FinanceProposalPart } from "@/components/assistant/finance-proposal"
import type { FinanceProposalResult } from "@/lib/finance/actions"
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
  get_inbox_summary: "Reading the review inbox",
  find_supplier_documents: "Finding supplier documents",
  get_document_details: "Reading a document",
  get_supplier_rules: "Reading supplier rules",
  get_expense_claims: "Reading expense claims",
}

/** Finance agent Act tools (Part 5c/WP3.5) — every one only ever proposes an action
 * (lib/finance/actions.ts), so they all render through the same Accept/Dismiss card rather than a
 * one-line "doing X" label. `decide_review_task_stage`/`decide_expense_claim` (WP3.5, ad9deec) were
 * missing from this set — the ai-chat route and finance-proposal.tsx both already handled them, but
 * without a matching entry here they fell through to the generic one-line "doing X" fallback below
 * instead of the Accept/Dismiss card, so a person could see the model propose a decision but never
 * had a way to act on it. Fixed as part of the Phase 3 follow-up pass. */
const FINANCE_PROPOSAL_TOOLS = new Set([
  "approve_review_tasks", "reject_review_task", "set_document_coding", "create_supplier_rule", "push_to_accounting",
  "decide_review_task_stage", "decide_expense_claim",
])

/** The AI assistant, docked to the left of the grid.
 *
 * Tool calls are executed here in the browser (see sheet-tools.ts) and the results posted back,
 * so the assistant answers from the workbook on screen rather than from the saved snapshot. */
export function AssistantPanel({ workspaceId, apiRef, onClose, documentSearchEnabled = false, onOpenSource, surface = "sheet", intents, emptyHint, title = "AI Assistant", className, initialMessage }: {
  workspaceId: string
  /** The live grid. A ref rather than a value because the panel mounts before Univer finishes
   * booting, and a question asked in that window still has to find a workbook to read. On a page
   * with no grid (the dictation verify screen) this is a ref that stays null and the server is
   * told not to register the sheet tools at all — see `surface`. */
  apiRef: RefObject<FUniver | null>
  onClose: () => void
  /** Additive and default-off: callers that do not pass these see today's behaviour exactly. When
   * on, the empty state gains a document intent and the search tool renders its Sources card. */
  documentSearchEnabled?: boolean
  onOpenSource?: (hit: SourceHit) => void
  /** Which page is asking. Sent to /api/ai-chat, which registers the spreadsheet tools only for
   * "sheet" — offering the model seven tools that can only answer "the spreadsheet is still
   * loading" wastes its step budget on the way to the same answer. "finance-inbox" (the review
   * queue) has no grid either, but is where the finance agent's tools/persona are meant to be. */
  surface?: "sheet" | "dictation" | "finance-inbox"
  /** Starter prompts for the empty state. Defaults to the spreadsheet's. */
  intents?: string[]
  emptyHint?: string
  title?: string
  className?: string
  initialMessage?: string
}) {
  const [input, setInput] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  // Pre-images of everything the assistant has written and the user has not yet ruled on. Held
  // outside React state because the tools write to it synchronously while a tool call runs; the
  // count below is only the part the bar needs to re-render on.
  const pending = useMemo(() => new PendingChanges(), [])
  const [pendingCount, setPendingCount] = useState(0)

  const { messages, sendMessage, addToolResult, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai-chat", body: { workspaceId, surface } }),
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
    <aside className={className ?? "absolute inset-0 z-20 flex flex-col bg-slate-50 sm:relative sm:inset-auto sm:z-auto sm:w-80 sm:shrink-0 sm:border-r"}>
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2">
        <Sparkles className="h-4 w-4 text-emerald-700" />
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <button type="button" aria-label="Close AI Assistant" className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {emptyHint ?? (documentSearchEnabled
                ? "Ask about the data in this sheet — or what the documents behind it actually say."
                : "Ask about the data in this sheet. The assistant reads the grid as you see it.")}
            </p>
            {(intents ?? (documentSearchEnabled ? [...INTENTS, DOCUMENT_INTENT] : INTENTS)).map((intent) => (
              <button key={intent} type="button" className="block w-full rounded-md border bg-white px-2.5 py-2 text-left text-xs text-slate-600 hover:border-emerald-300 hover:text-slate-900" onClick={() => ask(intent)}>
                {intent}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-6 rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white" : "space-y-1.5 text-sm text-slate-800"}>
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
              // Finance Act tools also run on the server (they only validate and describe a
              // proposal — see lib/finance/actions.ts), so their result arrives the same way
              // search_documents' does; the Accept/Dismiss card is what turns that into a decision
              // instead of a fact.
              if (part.type.startsWith("tool-") && FINANCE_PROPOSAL_TOOLS.has(part.type.slice("tool-".length))) {
                const p = part as { state: "input-streaming" | "input-available" | "output-available" | "output-error"; output?: FinanceProposalResult }
                return <FinanceProposalPart key={index} workspaceId={workspaceId} state={p.state} output={p.output} />
              }
              if (part.type.startsWith("tool-")) {
                const name = part.type.slice("tool-".length)
                return <p key={index} className="flex items-center gap-1.5 text-xs text-slate-500"><Table2 className="h-3 w-3" />{TOOL_LABELS[name] ?? name}</p>
              }
              return null
            })}
          </div>
        ))}

        {busy && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Thinking…</p>}
        {error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error.message}</p>}
      </div>

      <form
        className="flex items-end gap-1.5 border-t bg-white p-2"
        onSubmit={(event) => { event.preventDefault(); ask(input) }}>
        <textarea
          rows={2}
          value={input}
          placeholder="Ask anything…"
          className="min-w-0 flex-1 resize-none rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
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
    <div className="rounded-md bg-slate-100 px-2 py-1.5">
      <button type="button" className="flex w-full items-center gap-1 text-xs font-medium text-slate-500" onClick={() => setOpen((value) => !value)}>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />Thought
      </button>
      {open && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{text}</p>}
    </div>
  )
}
