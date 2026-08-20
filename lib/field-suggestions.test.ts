import { describe, expect, it } from "vitest"
import { buildDocumentJsonSchema } from "@/lib/document-templates"
import {
  buildFieldSuggestionInstructions, parseSuggestedTitle, parseSuggestedTranscriptFields,
  suggestedFieldsSchemaProperty, suggestedTitleSchemaProperty,
} from "@/lib/field-suggestions"

describe("buildFieldSuggestionInstructions", () => {
  it("frames supplement-mode suggestions as a last resort, not an invitation", () => {
    const instructions = buildFieldSuggestionInstructions("supplement")
    expect(instructions).toContain("_suggested_fields")
    expect(instructions).toContain("cannot be placed")
  })

  it("defaults to supplement mode when no mode is given", () => {
    expect(buildFieldSuggestionInstructions()).toEqual(buildFieldSuggestionInstructions("supplement"))
  })

  it("flips discover mode to propose a field per stated fact, and asks for a title", () => {
    const instructions = buildFieldSuggestionInstructions("discover")
    expect(instructions).toContain("no predefined fields")
    expect(instructions).toContain("_suggested_title")
    expect(instructions).not.toContain("cannot be placed")
  })
})

describe("suggestedTitleSchemaProperty", () => {
  it("is a plain string property", () => {
    expect(suggestedTitleSchemaProperty().type).toBe("string")
  })
})

describe("parseSuggestedTitle", () => {
  it("extracts and trims a title", () => {
    expect(parseSuggestedTitle({ _suggested_title: "  Kitchen inspection  " })).toBe("Kitchen inspection")
  })

  it("returns null rather than a placeholder when absent or malformed", () => {
    expect(parseSuggestedTitle({})).toBeNull()
    expect(parseSuggestedTitle({ _suggested_title: "" })).toBeNull()
    expect(parseSuggestedTitle({ _suggested_title: 42 })).toBeNull()
    expect(parseSuggestedTitle(null)).toBeNull()
  })
})

describe("buildDocumentJsonSchema with no fields (discover mode)", () => {
  it("omits _confidence and _provenance, which would otherwise be unsatisfiable empty-object schemas", () => {
    const schema = buildDocumentJsonSchema([])
    expect(schema.properties).not.toHaveProperty("_confidence")
    expect(schema.properties).not.toHaveProperty("_provenance")
    expect(schema.properties).toHaveProperty("_classification")
  })

  it("still emits both when fields are present", () => {
    const schema = buildDocumentJsonSchema([{ key: "diagnosis", label: "Diagnosis", type: "string", instruction: "", required: true }])
    expect(schema.properties).toHaveProperty("_confidence")
    expect(schema.properties).toHaveProperty("_provenance")
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

  it("caps supplement-mode suggestions at 6 so one dictation cannot flood the review queue", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `field_${i}`, label: `Field ${i}`, type: "string", value: "x" }))
    const result = parseSuggestedTranscriptFields({ _suggested_fields: many }, new Set())
    expect(result).toHaveLength(6)
  })

  it("caps discover-mode suggestions at 24 — here proposing fields IS the extraction", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `field_${i}`, label: `Field ${i}`, type: "string", value: "x" }))
    const result = parseSuggestedTranscriptFields({ _suggested_fields: many }, new Set(), "discover")
    expect(result).toHaveLength(24)
  })

  it("tolerates a missing or malformed _suggested_fields", () => {
    expect(parseSuggestedTranscriptFields({}, new Set())).toEqual([])
    expect(parseSuggestedTranscriptFields({ _suggested_fields: "not an array" }, new Set())).toEqual([])
    expect(parseSuggestedTranscriptFields(null, new Set())).toEqual([])
  })
})
