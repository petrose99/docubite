import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { personaAddendumForIndustry } from "@/lib/modules/personas"
import { findMatchingDocuments, searchDocumentChunks } from "@/lib/retrieval"
import { getWorkspaceMembership, consumeWorkspaceQuota } from "@/models/workspaces"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai"
import { z } from "zod"

/** The assistant's turn budget. Each profile/read is a step, so this allows a good deal of
 * looking around before an answer, while still ending a model that has started going in
 * circles. */
const MAX_STEPS = 12

const SYSTEM_PROMPT = `You are the DocuBite spreadsheet assistant. You help the user understand and analyse the spreadsheet they have open, which holds data extracted from their documents (invoices, receipts, bank statements).

How to work:
- ALWAYS call profile_workbook first. Never guess at sheet or column names — read them.
- Use read_range to look at the data you need. Ranges are A1 notation ("A1:D20"). Ask for the smallest range that answers the question.
- When your answer is about particular cells, call select_range so the user can see which ones.
- Do the arithmetic yourself from the values you read, and state the numbers you used.
- Answer in plain prose, briefly. No preamble, no restating the question.
- If the sheet does not contain what was asked for, say so plainly rather than inventing it.

Changing the sheet:
- Row 1 is the header row and row 2 is the first data row. Never overwrite the header unless asked.
- Prefer formulas over computed literals when the value depends on other cells, so it stays right when they change.
- add_column writes the header and fills the formula down every data row. Write that formula for the FIRST data row only (row 2) — it is shifted down automatically. Do not call write_cells for the rest of the column.
- Never edit cells the user did not ask you to touch, and never delete data to make room.
- Finish any turn that changed the sheet by calling task_complete, with one entry in changes per thing you did ("Sheet1!G1", "added Line Total header"). The user sees these as clickable links, so give real references.`

/** The dictation page's assistant. Same retrieval, no grid.
 *
 * A separate prompt rather than the spreadsheet one with the sheet paragraphs deleted, because the
 * two answer different questions: on the sheet the assistant is looking at a grid of many
 * documents, here it is sitting beside one clinical case that a person is about to sign. The
 * standing instruction not to interpret findings is the point — this assistant retrieves and
 * quotes; it does not offer a second opinion. */
const DICTATION_SYSTEM_PROMPT = `You are the DocuBite assistant, helping a clinician review a dictated case they are about to verify and sign.

How to work:
- You have no spreadsheet here. Answer from the documents, using search_documents and find_documents.
- Answer in plain prose, briefly. No preamble, no restating the question.
- Quote what a document says. Never paraphrase a diagnosis, grade, stage, or measurement — give the wording as recorded.
- NEVER offer a diagnosis, an interpretation, or a clinical opinion of your own, and never suggest what a finding "is consistent with". You retrieve and quote what is on record; the clinician decides what it means.
- If the record does not contain what was asked, say so plainly rather than filling the gap.`

/** Appended to the system prompt only when the document-search tool is registered (i.e. embeddings
 * are configured). Kept separate so the model is never told about a tool it does not have. */
const DOCUMENT_SEARCH_PROMPT = `

Answering from document contents:
- The grid holds extracted fields, but the full text of every uploaded document is also searchable. For a question about what a document actually says — wording, clauses, a value not in a column — call search_documents with a focused query.
- Ground the answer in the returned snippets and cite each fact as "filename, p.N" using the filename and page the snippet carries.
- Each snippet carries a "source": vlm_ocr means it was read off a scanned page, asr means it was transcribed from a dictation. Say which when it matters — a misheard word and a misread glyph are different kinds of error, and a user checking a surprising value needs to know which to suspect.
- If the search returns nothing relevant, say so plainly. Never invent a citation, a snippet, or a value.
- If a search returns no results and pendingIndexing is true, tell the user some documents are still being indexed and to ask again in a minute.

Counting and "all of them" questions:
- search_documents ranks passages and returns only the best few, so it can NEVER tell you how many documents match. Never count from its results, and never say "all" based on them.
- For how many / which ones / all / none / every — call find_documents. It returns the complete matching set with a true total.
- Report the total it gives you, not the number of documents it listed: it lists a sample and counts the rest.
- If it comes back with kind "no_filters", it could not turn the question into an exact condition. Its availableFields lists what is actually filterable; either ask again naming one of those fields, or tell the user the data does not record what they asked about.
- If truncated is true, say the total is at least that many rather than reporting it as exact.`

/** Tools declared with no `execute`. The AI SDK streams the call to the browser, which runs it
 * against the live Univer workbook and posts the result back — so the assistant reads the sheet
 * as it is on screen, unsaved edits included, and the server never needs a copy of it. The
 * document-search tool below is the exception: it runs on the server (it has `execute`). */
const sheetTools = {
  profile_workbook: tool({
    description: "List the sheets in the workbook with their headers and a few sample rows. Call this first, always.",
    inputSchema: z.object({ sampleRows: z.number().int().min(0).max(25).optional().describe("Rows of sample data per sheet (default 10)") }),
  }),
  read_range: tool({
    description: "Read a rectangular range of cells in A1 notation.",
    inputSchema: z.object({
      sheet: z.string().optional().describe("Sheet name; defaults to the active sheet"),
      range: z.string().describe('A1 notation, e.g. "A1:D20"'),
      includeFormulas: z.boolean().optional().describe("Also return the formulas behind the values"),
    }),
  }),
  select_range: tool({
    description: "Select a range in the grid so the user can see which cells the answer refers to.",
    inputSchema: z.object({ sheet: z.string().optional(), range: z.string().describe('A1 notation, e.g. "D2:D40"') }),
  }),
  write_cells: tool({
    description: "Write individual cells, each with a literal value or a formula. Use for a handful of scattered cells.",
    inputSchema: z.object({
      sheet: z.string().optional().describe("Sheet name; defaults to the active sheet"),
      cells: z.array(z.object({
        ref: z.string().describe('A1 notation of one cell, e.g. "D2"'),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().describe("Literal value; omit when giving a formula"),
        formula: z.string().optional().describe('Formula including the leading "=", e.g. "=B2*C2"'),
      })).min(1).max(500),
    }),
  }),
  write_range: tool({
    description: "Write a rectangle of literal values from a starting cell. Use for tables; formulas are not supported here.",
    inputSchema: z.object({
      sheet: z.string().optional(),
      startRef: z.string().describe('Top-left cell, e.g. "A2"'),
      values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).describe("Rows of values, outer array is rows"),
    }),
  }),
  add_column: tool({
    description: "Add a column with a header and optionally a formula filled down every data row. Give the formula for the first data row (row 2) only.",
    inputSchema: z.object({
      sheet: z.string().optional(),
      header: z.string().describe("Header text for row 1"),
      formula: z.string().optional().describe('Formula for the first data row, e.g. "=B2*C2"; shifted down automatically'),
      afterColumn: z.string().optional().describe('Column letter to insert after, e.g. "D"; omit to append at the end'),
    }),
  }),
  task_complete: tool({
    description: "End the turn after changing the sheet. Summarise what you did and list each change.",
    inputSchema: z.object({
      summary: z.string().describe("One or two sentences on what changed"),
      changes: z.array(z.object({
        target: z.string().describe('The cells changed, e.g. "Sheet1!G1:G12"'),
        action: z.string().describe('What happened there, e.g. "added Line Total"'),
      })).default([]),
    }),
  }),
} as const

export async function POST(request: Request) {
  const user = await getCurrentUser()
  // `surface` says which page is asking. The dictation page has no Univer grid, so registering the
  // sheet tools there would offer the model seven tools whose every call comes back "the
  // spreadsheet is still loading" — burning steps to reach the same answer it could have given
  // straight away. Unknown or absent means the sheet, so every existing caller is unaffected.
  const { messages, workspaceId, surface }: { messages: UIMessage[]; workspaceId: string; surface?: string } = await request.json()
  const onSheet = surface !== "dictation"

  if (!workspaceId || !(await getWorkspaceMembership(workspaceId, user.id))) return Response.json({ error: "forbidden" }, { status: 403 })

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace?.aiEnabled) return Response.json({ error: "ai_disabled" }, { status: 403 })

  if (!config.ai.geminiApiKey) return Response.json({ error: "ai_not_configured" }, { status: 503 })

  // Only a fresh question costs quota. The tool loop posts the conversation back on every step,
  // and billing those would charge a user several times for one request.
  const last = messages[messages.length - 1]
  if (last?.role === "user") {
    try {
      await consumeWorkspaceQuota(workspaceId, "ai")
    } catch (error) {
      // 429 means "come back later", which is true of an exhausted monthly allowance and false
      // of a lapsed trial or a dead subscription — those need a payment decision, so they get
      // 402 and their own code. A blanket 429 told every one of them to wait it out.
      const code = error instanceof Error ? error.message : "quota_exceeded"
      if (code === "trial_expired" || code === "subscription_inactive") return Response.json({ error: code }, { status: 402 })
      return Response.json({ error: "quota_exceeded" }, { status: 429 })
    }
  }

  const google = createGoogleGenerativeAI({ apiKey: config.ai.geminiApiKey })

  // The document-search tool is added, with a server `execute`, only when embeddings are
  // configured — the single feature gate. Its result flows back through the stream; the browser's
  // onToolCall is guarded to ignore it (see components/assistant/assistant-panel.tsx). No extra
  // quota: this turn already consumed one AI unit above.
  const gridTools = onSheet ? sheetTools : {}
  const tools = config.embeddings.enabled
    ? {
        ...gridTools,
        search_documents: tool({
          description: "Search the user's uploaded documents (invoices, receipts, bank statements) for text relevant to a question, and get back matching snippets with their filename and page. Use this for questions about what a document says, rather than about the spreadsheet grid.",
          inputSchema: z.object({ query: z.string().min(2).describe("What to look for, in a few words or a short phrase") }),
          execute: async ({ query }) => {
            try {
              const results = await searchDocumentChunks(workspaceId, query, { limit: 8, actorId: user.id })
              // Nothing found could mean nothing matches, or the just-uploaded documents are still
              // being embedded. One cheap count tells the two apart, so the model can say "still
              // indexing, ask again in a minute" rather than a flat "nothing found".
              if (results.length === 0) {
                const pending = await prisma.documentProcessingJob.count({ where: { workspaceId, type: "embed", status: { in: ["queued", "processing"] } } })
                return { results, pendingIndexing: pending > 0 }
              }
              return { results }
            } catch {
              // Never throw out of a tool — that would break the stream. The model is told the
              // search is unavailable and can answer from the grid or say it cannot.
              return { error: "document_search_unavailable" }
            }
          },
        }),
        find_documents: tool({
          description: "Find EVERY document whose extracted values match a condition — 'all invoices from Acme', 'anything due before March', 'shipments still in transit'. Returns a complete, counted set, not the closest matches. Use this whenever the question is about how many, which ones, or all of something. Do not use search_documents for counting.",
          inputSchema: z.object({ query: z.string().min(2).describe("The condition to match, in plain language, including any names, amounts or dates it mentions") }),
          execute: async ({ query }) => {
            try {
              const result = await findMatchingDocuments(workspaceId, query, { actorId: user.id })
              return result
            } catch {
              return { error: "document_lookup_unavailable" }
            }
          },
        }),
      }
    : gridTools

  const base = onSheet ? SYSTEM_PROMPT : DICTATION_SYSTEM_PROMPT
  const withSearch = config.embeddings.enabled ? base + DOCUMENT_SEARCH_PROMPT : base
  // Only on the sheet — the dictation assistant's whole point is to retrieve and quote, never to
  // propose an action, so a finance addendum (which is action-oriented) has no business there.
  const capabilities = onSheet ? await getWorkspaceCapabilities(workspaceId) : null
  const persona = capabilities?.has("finance-agent") ? personaAddendumForIndustry(capabilities.industry) : null
  const system = persona ? `${withSearch}\n\n${persona}` : withSearch

  const result = streamText({
    model: google(config.ai.geminiModelName),
    system,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })

  return result.toUIMessageStreamResponse({
    // The provider's per-model daily cap is the single most common failure here, and the raw
    // message does not say what to do about it. See the note in models/documents.ts on the same
    // trap. The provider is not named: which model answers is a deployment detail, and putting
    // a vendor in front of the user only invites questions nobody in this panel can act on.
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (/quota|429|RESOURCE_EXHAUSTED/i.test(message)) return "The daily AI quota for this workspace's model is spent. Try again tomorrow, or ask an administrator to switch the configured model."
      return message
    },
  })
}
