import { beforeEach, describe, expect, it, vi } from "vitest"

/** Editing a draft's prose: what it refuses, and what it refuses to let through.
 *
 * Kept out of report-drafts.test.ts because that file mocks `prisma` as an empty object for the
 * pure-render tests; these need a stub with behaviour. */

const findFirst = vi.fn()
const update = vi.fn()

vi.mock("@/lib/db", () => ({ prisma: { documentReportDraft: { findFirst: (...args: unknown[]) => findFirst(...args), update: (...args: unknown[]) => update(...args) } } }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
vi.mock("@/lib/config", () => ({ default: { ai: { provider: "gemini", geminiApiKey: "", geminiModelName: "m", openaiApiKey: "", openaiModelName: "" } } }))

const { updateReportDraftNarrative } = await import("@/models/report-drafts")
const { NOT_DICTATED } = await import("@/lib/report-render/narrative")

const template = {
  narrativeSections: [
    { key: "gross", title: "Gross description", instruction: "" },
    { key: "micro", title: "Microscopic", instruction: "" },
  ],
}

const draft = {
  id: "draft-1",
  documentId: "doc-1",
  status: "draft",
  narrative: { gross: "Received fresh.", micro: NOT_DICTATED },
  renderedText: "*** DRAFT ***\n\nDIAGNOSIS / SYNOPTIC\nDiagnosis: IDC\n\nGROSS DESCRIPTION\nReceived fresh.",
  template,
}

beforeEach(() => {
  findFirst.mockReset()
  update.mockReset()
  update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...draft, ...data }))
})

describe("updateReportDraftNarrative", () => {
  it("refuses a signed draft — the text someone signed stays the text they signed", async () => {
    findFirst.mockResolvedValue({ ...draft, status: "signed" })
    await expect(updateReportDraftNarrative({ workspaceId: "w", draftId: "draft-1", narrative: { gross: "Rewritten." } }))
      .rejects.toThrow("report_already_signed")
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses a draft in another workspace", async () => {
    findFirst.mockResolvedValue(null)
    await expect(updateReportDraftNarrative({ workspaceId: "other", draftId: "draft-1", narrative: {} }))
      .rejects.toThrow("report_draft_not_found")
  })

  /** Iterates the template's sections, never the submitted keys — the same rule renderSynoptic
   * follows, and the reason a request cannot introduce a section the template does not have. */
  it("ignores a section the template does not name", async () => {
    findFirst.mockResolvedValue(draft)
    const result = await updateReportDraftNarrative({
      workspaceId: "w", draftId: "draft-1",
      narrative: { gross: "Received fresh in formalin.", diagnosis: "Something else entirely" },
    })
    const narrative = (update.mock.calls[0][0] as { data: { narrative: Record<string, string> } }).data.narrative
    expect(Object.keys(narrative).sort()).toEqual(["gross", "micro"])
    expect(narrative.gross).toBe("Received fresh in formalin.")
    expect(result.renderedText).not.toContain("Something else entirely")
  })

  it("keeps the existing text for a section that was not submitted", async () => {
    findFirst.mockResolvedValue(draft)
    await updateReportDraftNarrative({ workspaceId: "w", draftId: "draft-1", narrative: { micro: "Sheets of tumour." } })
    const narrative = (update.mock.calls[0][0] as { data: { narrative: Record<string, string> } }).data.narrative
    expect(narrative.gross).toBe("Received fresh.")
    expect(narrative.micro).toBe("Sheets of tumour.")
  })

  it("re-renders with the draft banner and preserves the synoptic block verbatim", async () => {
    findFirst.mockResolvedValue(draft)
    const result = await updateReportDraftNarrative({ workspaceId: "w", draftId: "draft-1", narrative: { gross: "Received fresh in formalin." } })
    // The synoptic half is deterministic and is NOT re-derived here; an edit to the prose must not
    // be able to disturb the part of the report that came straight from the dictated values.
    expect(result.renderedText).toContain("DIAGNOSIS / SYNOPTIC\nDiagnosis: IDC")
    expect(result.renderedText).toContain("Received fresh in formalin.")
    expect(result.renderedText).toContain("NOT FOR CLINICAL USE")
  })
})
