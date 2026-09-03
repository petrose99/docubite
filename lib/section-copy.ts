export type SectionKey = "extraction" | "library" | "sheets" | "dashboard"

export interface SectionCopy {
  banner: string
  howItWorks: string[]
}

export const SECTION_COPY: Record<SectionKey, SectionCopy> = {
  extraction: {
    banner:
      "Extraction is your inbox: drop files, we OCR, split and extract, you review the results.",
    howItWorks: [
      "Add PDFs or drag a folder — we run OCR automatically.",
      "Multi-page files are split into individual documents for you to confirm.",
      "Review extracted fields, fix anything off, then the document moves to the Docu Library.",
    ],
  },
  library: {
    banner:
      "Docu Library is the permanent record of every document, searchable in plain language.",
    howItWorks: [
      "Reviewed documents land here automatically — browse, filter, and search across everything.",
      "Pull documents into Sheets whenever you need to compute or analyse.",
    ],
  },
  sheets: {
    banner:
      "Sheets are spreadsheets you compute in; pull documents from extraction, import your own files, and ask the AI assistant to do the work.",
    howItWorks: [
      "Start a blank sheet, import xlsx/csv, or pull documents from Extraction.",
      "Use formulas, the =AI() function, and the AI assistant side-panel.",
      "Every cell keeps provenance — click to jump back to the source document page.",
    ],
  },
  dashboard: {
    banner:
      "Your workspace at a glance: see what needs attention and pick up where you left off.",
    howItWorks: [
      "Stat cards show documents this month, in review, ready, and in sheets.",
      "The review queue surfaces documents that need your input.",
      "Recent files let you jump straight back into a sheet.",
    ],
  },
}

export const ONBOARDING_STEPS = [
  { key: "upload", label: "Add your first document", section: "extraction" as SectionKey },
  { key: "review", label: "Review a document", section: "extraction" as SectionKey },
  { key: "find_library", label: "Find it in Docu Library", section: "library" as SectionKey },
  { key: "pull_sheet", label: "Pull it into a Sheet", section: "sheets" as SectionKey },
  { key: "ask_question", label: "Ask a question", section: "sheets" as SectionKey },
] as const

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"]

export const TOUR_STEPS = [
  { target: "extraction", title: "Extraction", description: "Add and review documents here." },
  { target: "library", title: "Docu Library", description: "Your permanent, searchable document library." },
  { target: "sheets", title: "Sheets", description: "Spreadsheets with AI — pull documents in and compute." },
  { target: "search", title: "Search", description: "Find any document from anywhere, or ask a question." },
] as const
