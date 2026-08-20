/** The route registry for agnostic dictation.
 *
 * Each route is a task type the embedding router (lib/dictation/router.ts) can send a free-form
 * dictation to. Adding a task type is an entry here — nothing in the router, the pipeline, or the
 * UI needs to change. `examples` are embedded once (module-scope cache in router.ts) and matched
 * against the dictated transcript by cosine similarity, so they should sound like things a person
 * would actually say at the start of a dictation, not a description of the category.
 *
 * `defaultFormat` is what Stage C renders to when the speaker did not also speak an explicit format
 * ("make this a table"). It must name a key in lib/dictation/formats.ts. `workspaceTemplateHint` is
 * optional guidance for which of the workspace's own DocumentTemplate rows this route's fields
 * probably belong to (matched by name, best-effort, in lib/dictation/pipeline.ts) — a route never
 * requires a template to exist; with none found the dictation stays on the blank/general schema. */

export type DictationRoute = {
  /** Unique route name — also the `intent` value stored on the document. "general" is reserved: it
   * is the built-in fallback, never listed here, and never a route a real recording can score into. */
  name: string
  examples: string[]
  defaultFormat: string
  workspaceTemplateHint?: string
}

export const DICTATION_ROUTES: DictationRoute[] = [
  {
    name: "pathology_report",
    workspaceTemplateHint: "pathology",
    defaultFormat: "soap_note",
    examples: [
      "Specimen received, formalin fixed, labeled with the patient's name.",
      "Gross description: a single fragment of tissue measuring two by one centimeters.",
      "Microscopic exam shows infiltrating carcinoma with clear margins.",
      "This is a pathology report for the biopsy taken yesterday.",
      "Final diagnosis is invasive ductal carcinoma, grade two.",
    ],
  },
  {
    name: "finance_record",
    workspaceTemplateHint: "finance",
    defaultFormat: "table",
    examples: [
      "Log an expense of two hundred dollars for office supplies paid to Staples.",
      "This invoice is from Acme Corp for four thousand five hundred dollars, due in thirty days.",
      "Record a payment received from the client for last month's consulting.",
      "Add a line item, fifty units at twelve dollars each.",
      "This is a receipt for a business lunch, forty two dollars.",
    ],
  },
  {
    name: "logistics_record",
    workspaceTemplateHint: "logistics",
    defaultFormat: "table",
    examples: [
      "Shipment of twenty pallets leaving the warehouse for the Denver distribution center.",
      "Bill of lading for container number MSCU one two three four five six.",
      "The truck is delayed, expected delivery pushed to Thursday.",
      "Log a delivery of raw materials received at dock three.",
      "Tracking number for this shipment is one Z nine nine nine nine nine.",
    ],
  },
  {
    name: "email_draft",
    defaultFormat: "email",
    examples: [
      "Draft an email to the client explaining the delay.",
      "Send a message to the team letting them know the meeting moved.",
      "Write an email to accounting asking about the overdue invoice.",
      "I need to email the vendor about the missing shipment.",
      "Compose a follow-up email to yesterday's call.",
    ],
  },
  {
    name: "summary",
    defaultFormat: "bullets",
    examples: [
      "Summarize what we covered in today's meeting.",
      "Give me a quick summary of this case.",
      "Recap the key points from the call.",
      "Boil this down to the highlights.",
    ],
  },
  {
    name: "todo",
    defaultFormat: "todo",
    examples: [
      "Remind me to follow up with the client next week.",
      "Add a task to review the contract before Friday.",
      "I need to call the supplier tomorrow morning.",
      "Make a to-do list: order supplies, schedule the inspection, send the invoice.",
    ],
  },
  {
    name: "general_note",
    defaultFormat: "narrative",
    examples: [
      "Just making a quick note for myself.",
      "Here's a thought I want to record.",
      "Noting this down so I don't forget it.",
    ],
  },
]

export function findRoute(name: string | null | undefined): DictationRoute | null {
  if (!name) return null
  return DICTATION_ROUTES.find((route) => route.name === name) ?? null
}
