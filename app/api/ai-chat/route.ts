import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import {
  describeApproveReviewTasks, describeCreateSupplierRule, describeDecideExpenseClaim, describeDecideReviewTaskStage,
  describePushToAccounting, describeRejectReviewTask, describeSetDocumentCoding,
} from "@/lib/finance/actions"
import { findSupplierDocuments, getDocumentDetails, getExpenseClaims, getInboxSummary, getSupplierRules } from "@/lib/finance/inbox"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { personaAddendumForIndustry } from "@/lib/modules/personas"
import { findMatchingDocuments, searchDocumentChunks } from "@/lib/retrieval"
import { getWorkspaceMembership } from "@/models/workspaces"
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

/** The finance review-inbox page's assistant. No grid, no dictation transcript — just the queue,
 * documents, and supplier rules for this workspace. Only reachable when finance-agent is on
 * (surface "finance-inbox" is otherwise identical to "sheet" for tool-registration purposes, see
 * `financeAgentEnabled` below), so this prompt can assume every finance tool actually exists. */
const FINANCE_INBOX_SYSTEM_PROMPT = `You are the DocuBite finance assistant, helping someone work through their review inbox and supplier rules. There is no spreadsheet grid here — work only through your tools.

How to work:
- Use get_inbox_summary, find_supplier_documents, get_document_details, get_supplier_rules, and get_expense_claims to answer questions and find what's being asked about. Look things up rather than guessing at ids or numbers.
- Answer in plain prose, briefly. No preamble, no restating the question.
- A review task on an approval workflow (get_document_details' reviewTasks list shows a workflowId) can only move through decide_review_task_stage, never approve_review_tasks/reject_review_task — those two refuse a workflow task outright. A plain, workflow-less task is the reverse: use approve_review_tasks/reject_review_task for it.
- To take an action — approve or reject a review task (plain or a workflow's current stage), decide an expense claim, set a document's coding, create a supplier rule, or push a document to accounting — call the matching tool (approve_review_tasks, reject_review_task, decide_review_task_stage, decide_expense_claim, set_document_coding, create_supplier_rule, push_to_accounting). Every one of these PROPOSES the action; it does not perform it. The tool's result is a summary of what would happen — say what you're proposing and that it's waiting for their confirmation in the panel below. Never claim an action happened, or that a document was pushed, coded, or a task or claim approved, until you see the person confirm it landed.
- If a tool returns an error, explain what it means in plain terms rather than repeating the error code, and suggest what to check (e.g. "no active accounting connection" means Settings → Integrations needs a connected provider first).`

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
  // straight away. "finance-inbox" (the review queue's assistant panel) has no grid either, but
  // — unlike dictation — is exactly where the finance tools/persona belong. Unknown or absent
  // means the sheet, so every existing caller is unaffected.
  const { messages, workspaceId, surface }: { messages: UIMessage[]; workspaceId: string; surface?: string } = await request.json()
  const hasGrid = surface !== "dictation" && surface !== "finance-inbox"
  const financeSurfaceAllowed = surface !== "dictation"

  if (!workspaceId || !(await getWorkspaceMembership(workspaceId, user.id))) return Response.json({ error: "forbidden" }, { status: 403 })

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace?.aiEnabled) return Response.json({ error: "ai_disabled" }, { status: 403 })

  if (!config.ai.geminiApiKey) return Response.json({ error: "ai_not_configured" }, { status: 503 })

  const google = createGoogleGenerativeAI({ apiKey: config.ai.geminiApiKey })

  // Not on dictation — its whole point is to retrieve and quote, never to propose an action, so
  // finance tools/persona (action-oriented) have no business there.
  const capabilities = financeSurfaceAllowed ? await getWorkspaceCapabilities(workspaceId) : null
  const financeAgentEnabled = capabilities?.has("finance-agent") ?? false

  // The document-search tool is added, with a server `execute`, only when embeddings are
  // configured — the single feature gate. Its result flows back through the stream; the browser's
  // onToolCall is guarded to ignore it (see components/assistant/assistant-panel.tsx). No extra
  // quota: this turn already consumed one AI unit above.
  const gridTools = hasGrid ? sheetTools : {}
  const searchTools = config.embeddings.enabled
    ? {
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
    : {}

  // Finance agent tools (Part 5c). Gated on the finance-agent module, same as the persona
  // addendum below. Read tools are plain data lookups with no side effect and run straight
  // through. Act tools (approve/reject/code/create-rule/push) never mutate here — each one
  // validates the request and returns a proposal (lib/finance/actions.ts); the ai-chat message
  // renderer (components/assistant/finance-proposal.tsx) shows it with Accept/Dismiss, and only
  // Accept calls the real server action. That is what "agent proposes, human confirms" means for
  // actions with a real side effect, as distinct from the sheet's write-then-undo cell tools —
  // see lib/finance/actions.ts's header comment for why the ordering has to be this way round.
  const financeTools = financeAgentEnabled
    ? {
        get_inbox_summary: tool({
          description: "Get counts of review-queue tasks by status, how many documents currently have a failing check, and how many have no supplier rule applied. Use this for 'what needs attention' or 'give me a summary' questions.",
          inputSchema: z.object({}),
          execute: async () => {
            try { return await getInboxSummary(workspaceId) } catch { return { error: "inbox_summary_unavailable" } }
          },
        }),
        find_supplier_documents: tool({
          description: "Find invoices/receipts from a given supplier or merchant name.",
          inputSchema: z.object({ supplier: z.string().min(1).describe("Supplier or merchant name, or part of one") }),
          execute: async ({ supplier }) => {
            try { return { results: await findSupplierDocuments(workspaceId, supplier) } } catch { return { error: "supplier_lookup_unavailable" } }
          },
        }),
        get_document_details: tool({
          description: "Get one document's extracted fields, per-field confidence, coding, applied rule, check results, and review-task history.",
          inputSchema: z.object({ documentId: z.string().describe("The document id") }),
          execute: async ({ documentId }) => {
            try {
              const details = await getDocumentDetails(workspaceId, documentId)
              return details ?? { error: "document_not_found" }
            } catch { return { error: "document_details_unavailable" } }
          },
        }),
        get_supplier_rules: tool({
          description: "List this workspace's active supplier coding rules (matcher, coding actions, autopublish, hit count).",
          inputSchema: z.object({}),
          execute: async () => {
            try { return { rules: await getSupplierRules(workspaceId) } } catch { return { error: "rules_unavailable" } }
          },
        }),
        get_expense_claims: tool({
          description: "List submitted-or-later expense claims (claim id, title, status, total, whether it's on an approval workflow). Use this to find a claim id before decide_expense_claim. Excludes drafts — nothing to decide about one yet.",
          inputSchema: z.object({}),
          execute: async () => {
            if (!(await getWorkspaceCapabilities(workspaceId)).has("expense-approvals")) return { error: "expense_approvals_not_enabled" }
            try { return { claims: await getExpenseClaims(workspaceId) } } catch { return { error: "expense_claims_unavailable" } }
          },
        }),
        approve_review_tasks: tool({
          description: "Propose approving one or more review tasks, by review-task id (from get_document_details' reviewTasks list, not a document id). Does not approve them — returns a proposal for the person to confirm.",
          inputSchema: z.object({ taskIds: z.array(z.string()).min(1).describe("Review task ids to approve") }),
          execute: async ({ taskIds }) => {
            try { return await describeApproveReviewTasks(workspaceId, taskIds) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        reject_review_task: tool({
          description: "Propose rejecting one review task, by review-task id. Does not reject it — returns a proposal for the person to confirm.",
          inputSchema: z.object({ taskId: z.string().describe("The review task id") }),
          execute: async ({ taskId }) => {
            try { return await describeRejectReviewTask(workspaceId, taskId) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        set_document_coding: tool({
          description: "Propose setting a document's coding (account, tax code, cost centre — whatever keys this workspace's rules use) directly, bypassing rule matching. Does not write it — returns a proposal for the person to confirm.",
          inputSchema: z.object({
            documentId: z.string().describe("The document id"),
            codingData: z.record(z.string(), z.union([z.string(), z.number()])).describe('Keys the workspace already uses, e.g. { "account": "6000" }'),
          }),
          execute: async ({ documentId, codingData }) => {
            try { return await describeSetDocumentCoding(workspaceId, documentId, codingData) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        create_supplier_rule: tool({
          description: "Propose a new supplier coding rule. Does not create it — returns a proposal for the person to confirm.",
          inputSchema: z.object({
            name: z.string().optional().describe("Rule name; defaults to the matcher text"),
            matcherType: z.enum(["exact", "contains"]).describe("Whether the supplier must match exactly or just contain this text"),
            matcherValue: z.string().min(1).describe("The supplier name (or part of it) to match"),
            account: z.string().min(1).describe("The account/code to assign on a match"),
            requireReview: z.boolean().optional().describe("Always send a match to the review queue even though the rule applied"),
            autopublish: z.boolean().optional().describe("Push a match to the connected accounting system automatically"),
          }),
          execute: async (input) => {
            try { return await describeCreateSupplierRule(workspaceId, input) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        push_to_accounting: tool({
          description: "Propose pushing a reviewed document to the workspace's connected accounting provider. Does not push it — returns a proposal for the person to confirm.",
          inputSchema: z.object({ documentId: z.string().describe("The document id") }),
          execute: async ({ documentId }) => {
            try { return await describePushToAccounting(workspaceId, documentId) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        decide_review_task_stage: tool({
          description: "Propose approving or rejecting the *current stage* of a review task that is on an approval workflow (has a workflowId — check get_document_details' reviewTasks list). Does not use this for a plain, workflow-less task — use approve_review_tasks/reject_review_task for that instead. Does not decide it — returns a proposal for the person to confirm.",
          inputSchema: z.object({
            taskId: z.string().describe("The review task id"),
            decision: z.enum(["approve", "reject"]).describe("Approve the current stage, or reject the task outright"),
          }),
          execute: async ({ taskId, decision }) => {
            try { return await describeDecideReviewTaskStage(workspaceId, taskId, decision) } catch { return { error: "proposal_unavailable" } }
          },
        }),
        decide_expense_claim: tool({
          description: "Propose approving or rejecting a submitted expense claim, whether or not it's on an approval workflow. Does not decide it — returns a proposal for the person to confirm.",
          inputSchema: z.object({
            claimId: z.string().describe("The expense claim id"),
            decision: z.enum(["approve", "reject"]).describe("Approve or reject the claim (its current stage, if it has a workflow)"),
          }),
          execute: async ({ claimId, decision }) => {
            try { return await describeDecideExpenseClaim(workspaceId, claimId, decision) } catch { return { error: "proposal_unavailable" } }
          },
        }),
      }
    : {}

  // The three tool groups are each typed by their own conditional (empty-object-or-not) branch,
  // which TS won't merge structurally on its own — cast to streamText's own tools param type
  // rather than fight three near-identical narrowed object types.
  const tools = { ...gridTools, ...searchTools, ...financeTools } as NonNullable<Parameters<typeof streamText>[0]["tools"]>

  const base = surface === "dictation" ? DICTATION_SYSTEM_PROMPT : surface === "finance-inbox" ? FINANCE_INBOX_SYSTEM_PROMPT : SYSTEM_PROMPT
  const withSearch = config.embeddings.enabled ? base + DOCUMENT_SEARCH_PROMPT : base
  const persona = financeAgentEnabled && capabilities ? personaAddendumForIndustry(capabilities.industry) : null
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
