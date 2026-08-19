import { describe, expect, it } from "vitest"
import { buildFieldSuggestionInstructions, parseSuggestedTranscriptFields, suggestedFieldsSchemaProperty } from "@/lib/field-suggestions"

describe("buildFieldSuggestionInstructions", () => {
  it("frames suggestions as a last resort, not an invitation", () => {
    const instructions = buildFieldSuggestionInstructions()
    expect(instructions).toContain("_suggested_fields")
    expect(instructions).toContain("cannot be placed")
  })
})

describe("suggestedFieldsSchemaProperty", () => {
  it("is an array of objects requiring key, label, type and value", () => {
    const schema = suggestedFieldsSchemaProperty()
    expect(schema.type).toBe("array")
    expect(schema.items.required).toEqual(["key", "label", "type", "value"])
    expect(schema.items.additionalProperties).toBe(false)
  })
})

describe("parseSuggestedTranscriptFields", () => {
  it("passes well-formed proposals through", () => {
    const result = parseSuggestedTranscriptFields(
      { _suggested_fields: [{ key: "ki67_index", label: "Ki-67 Index", type: "number", instruction: "The Ki-67 proliferation index as a percentage", value: "18", quote: "Ki-67 index is eighteen percent", confidence: 0.9 }] },
      new Set(["diagnosis", "grade"]),
    )
    expect(result).toEqual([{ key: "ki67_index", label: "Ki-67 Index", type: "number", instruction: "The Ki-67 proliferation index as a percentage", value: "18", quote: "Ki-67 index is eighteen percent", confidence: 0.9 }])
  })

  it("drops a proposal whose key already exists in the template", () => {
    // Not a new field — the model failing to use the field it already had.
    const result = parseSuggestedTranscriptFields({ _suggested_fields: [{ key: "grade", label: "Grade", type: "string", value: "3" }] }, new Set(["grade"]))
    expect(result).toEqual([])
  })

  it("drops duplicate keys within one response, keeping the first", () => {
    const result = parseSuggestedTranscriptFields(
      { _suggested_fields: [
        { key: "margin_note", label: "Margin Note", type: "string", value: "close but clear" },
        { key: "margin_note", label: "Margin Note Again", type: "string", value: "different value" },
      ] },
      new Set(),
    )
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe("close but clear")
  })

  it("drops an entry missing a value or an unrepairable key", () => {
    const result = parseSuggestedTranscriptFields(
      { _suggested_fields: [{ key: "no_value", label: "No Value", type: "string" }, { key: "!!!", label: "Bad Key", type: "string", value: "x" }] },
      new Set(),
    )
    expect(result).toEqual([])
  })

  it("coerces an unsupported type (array, enum) down to string rather than dropping the proposal", () => {
    const result = parseSuggestedTranscriptFields({ _suggested_fields: [{ key: "extra_note", label: "Extra Note", type: "array", value: "something odd" }] }, new Set())
    expect(result).toEqual([{ key: "extra_note", label: "Extra Note", type: "string", instruction: "", value: "something odd", quote: "", confidence: null }])
  })

  it("caps the number of suggestions so one dictation cannot flood the review queue", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `field_${i}`, label: `Field ${i}`, type: "string", value: "x" }))
    const result = parseSuggestedTranscriptFields({ _suggested_fields: many }, new Set())
    expect(result.length).toBeLessThanOrEqual(6)
  })

  it("tolerates a missing or malformed _suggested_fields", () => {
    expect(parseSuggestedTranscriptFields({}, new Set())).toEqual([])
    expect(parseSuggestedTranscriptFields({ _suggested_fields: "not an array" }, new Set())).toEqual([])
    expect(parseSuggestedTranscriptFields(null, new Set())).toEqual([])
  })
})
