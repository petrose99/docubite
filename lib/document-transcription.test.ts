import { parseTemplateFields } from "@/lib/document-templates"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {} }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
// Cuts the models/workspaces -> models/files chain, whose runtime `import { Prisma }` fails to
// resolve under vitest. Only the two pure functions below are under test; nothing here calls it.
vi.mock("@/models/workspaces", () => ({ consumeWorkspaceQuota: vi.fn() }))

const { buildTranscriptPrompt, findUnsupportedFields } = await import("@/lib/document-transcription")

const fields = parseTemplateFields([
  { key: "vendor", label: "Supplier", type: "string", instruction: "", required: true },
  { key: "total", label: "Total", type: "number", instruction: "", required: false },
  { key: "line_items", label: "Line items", type: "array", instruction: "", required: false, itemFields: [
    { key: "description", label: "Description", type: "string", instruction: "", required: false },
  ] },
])

const noProvenance = { fields: {}, items: {} }

describe("findUnsupportedFields", () => {
  // The observed case: "Let's make a specimen." produced total: 0, with no confidence score and no
  // segment it could be pinned to. A zero total is legitimate on a credit note, so it cannot be
  // rejected on its value — only on the fact that nothing in the audio backs it.
  it("flags a value with neither a confidence score nor audio provenance", () => {
    expect(findUnsupportedFields(fields, { total: 0 }, {}, noProvenance)).toEqual(["total"])
  })

  it("does not flag a value the model scored, even with no provenance", () => {
    // A normalised numeral ("2" for spoken "two") routinely fails to pin, so a score alone is
    // enough to treat the value as supported.
    expect(findUnsupportedFields(fields, { total: 0 }, { total: 0.9 }, noProvenance)).toEqual([])
  })

  it("does not flag a value pinned to a moment in the audio, even with no score", () => {
    const provenance = { fields: { total: { startMs: 0, endMs: 1000 } }, items: {} }
    expect(findUnsupportedFields(fields, { total: 0 }, {}, provenance)).toEqual([])
  })

  it("ignores fields with no value at all — that is 'missing', not 'unsupported'", () => {
    expect(findUnsupportedFields(fields, { vendor: "", total: null }, {}, noProvenance)).toEqual([])
    expect(findUnsupportedFields(fields, {}, {}, noProvenance)).toEqual([])
  })

  it("checks array fields against their own provenance list", () => {
    const values = { line_items: [{ description: "x" }] }
    expect(findUnsupportedFields(fields, values, {}, noProvenance)).toEqual(["line_items"])
    expect(findUnsupportedFields(fields, values, {}, { fields: {}, items: { line_items: [{}] } })).toEqual([])
  })

  it("flags several fields at once, in template order", () => {
    expect(findUnsupportedFields(fields, { vendor: "Acme", total: 5 }, {}, noProvenance)).toEqual(["vendor", "total"])
  })
})

describe("buildTranscriptPrompt", () => {
  it("frames the task as sorting what was said, not as writing a document", () => {
    const prompt = buildTranscriptPrompt("invoice", fields, "some transcript", [])
    expect(prompt).toContain("Sort what was SAID into the fields below")
    expect(prompt).toContain("Never infer, complete, or normalise a value that was not spoken")
    expect(prompt).toContain("A field the speaker did not mention is omitted entirely")
  })

  it("tells the model to mark uncertain audio rather than guess it", () => {
    expect(buildTranscriptPrompt("invoice", fields, "t", [])).toContain("[unclear]")
  })

  it("includes domain vocabulary when given, and omits the section when not", () => {
    expect(buildTranscriptPrompt("report", fields, "t", ["adenocarcinoma", "Ki-67"])).toContain("adenocarcinoma, Ki-67")
    expect(buildTranscriptPrompt("report", fields, "t", [])).not.toContain("Domain vocabulary")
  })

  it("carries the transcript itself", () => {
    expect(buildTranscriptPrompt("invoice", fields, "the vendor is Acme", [])).toContain("the vendor is Acme")
  })
})
