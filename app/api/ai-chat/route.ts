import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
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

/** Tools declared with no `execute`. The AI SDK streams the call to the browser, which runs it
 * against the live Univer workbook and posts the result back — so the assistant reads the sheet
 * as it is on screen, unsaved edits included, and the server never needs a copy of it. */
const tools = {
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
  const { messages, workspaceId }: { messages: UIMessage[]; workspaceId: string } = await request.json()

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

  const result = streamText({
    model: google(config.ai.geminiModelName),
    system: SYSTEM_PROMPT,
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
