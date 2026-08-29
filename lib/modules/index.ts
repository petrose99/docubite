import type { Industry } from "@/types/industry"

/** The module registry: every feature area the app knows about, keyed by module key. Mirrors
 * lib/domains/index.ts's shape — a flat array + pure lookup functions, no database — so capability
 * checks (lib/modules/capabilities.ts) and the sidebar/catalog UI (Part 3/4) read a module's
 * behaviour from here rather than branching on industry strings throughout the app. Adding a
 * module is one entry below (plus, if it gates a real feature, one requireModule call site) —
 * never a new ad-hoc `workspace.industry === "..."` check.
 *
 * tier: "always" — on for every workspace of its industry, not toggleable (this is what replaces
 * the old two-value assertMode gate for core surfaces). "default" — on unless a row in
 * WorkspaceModule disables it. "optional" — off unless enabled (activation "enable") or requested
 * (activation "request", surfaced to the owner as a request rather than a self-serve toggle). */
export type ModuleTier = "always" | "default" | "optional"
export type ModuleActivation = "enable" | "request"

export type ModuleDefinition = {
  key: string
  name: string
  description: string
  /** "core" modules are shared across every industry (documents, sheets, search, assistant,
   * reports) — modulesForIndustry always includes them alongside the workspace's own industry. */
  industry: Industry | "core"
  tier: ModuleTier
  activation: ModuleActivation
  navItems?: { href: string; label: string; icon: string }[]
  /** A prerequisite the workspace/deployment must satisfy before the module can be enabled at
   * all, independent of the industry/tier gating resolveModules already does. */
  requiresConfig?: "asr" | "integrations" | "embeddings"
  /** A plan-level flag (see lib/plans.ts's PlanLimits.integrations) the workspace's subscription
   * must carry — checked the same way workspaceIntegrationsPlanEnabled does in models/integrations.ts. */
  requiresPlanFlag?: "integrations"
  /** Document template codes this module can push to an external accounting system once enabled. */
  pushableTemplateCodes?: string[]
  /** The lib/domains adapter set this module's worksheets are drawn from, for seeding (lib/modules/seeds.ts). */
  domainPack?: "finance" | "pathology" | "logistics" | "construction"
  /** Optional-tier template codes this module materializes into a file when enabled (via the same
   * addDomainPackToFile mechanism the templates settings page already uses for domain packs). */
  optionalTemplateCodes?: string[]
}

export const MODULES: ModuleDefinition[] = [
  { key: "documents", name: "Documents", description: "Upload, store, and organize source documents.", industry: "core", tier: "always", activation: "enable" },
  { key: "sheets", name: "Sheets", description: "Structured extraction worksheets over your documents.", industry: "core", tier: "always", activation: "enable" },
  { key: "search", name: "Search", description: "Cross-document semantic search.", industry: "core", tier: "always", activation: "enable" },
  { key: "assistant", name: "AI Assistant", description: "Ask questions and take actions across your workspace.", industry: "core", tier: "always", activation: "enable" },
  { key: "reports", name: "Reports", description: "Draft and export reports from extracted data.", industry: "core", tier: "always", activation: "enable" },

  { key: "review-queue", name: "Review queue", description: "Triage incoming documents that need a person to look at them.", industry: "finance", tier: "default", activation: "enable", navItems: [{ href: "review", label: "Review", icon: "inbox" }] },
  // Dext-parity Phase 3 WP3.1/WP3.2: multi-stage approval workflows on top of the review queue.
  // Flipped to "enable" now that WP3.2 ships the settings UI to build/edit workflows — same
  // precedent as bank-match going "request" -> "enable" once WP2.2 shipped its UI.
  { key: "approval-workflows", name: "Approval workflows", description: "Route a document through multiple approval stages before it's marked approved.", industry: "finance", tier: "optional", activation: "enable", navItems: [{ href: "settings/approvals", label: "Approvals", icon: "check-circle" }] },
  { key: "supplier-rules", name: "Supplier rules", description: "Auto-code recurring suppliers and, optionally, auto-publish them.", industry: "finance", tier: "default", activation: "enable", navItems: [{ href: "settings/rules", label: "Rules", icon: "workflow" }] },
  { key: "document-checks", name: "Document checks", description: "Deterministic duplicate, arithmetic, tax, and gap checks on every document.", industry: "finance", tier: "default", activation: "enable" },
  { key: "tax-profiles", name: "Tax profiles", description: "Per-workspace tax rate and jurisdiction settings.", industry: "finance", tier: "default", activation: "enable", navItems: [{ href: "settings/tax", label: "Tax", icon: "percent" }] },
  { key: "accounting-push", name: "Accounting push", description: "Push invoices, receipts, and expenses to QuickBooks or Xero.", industry: "finance", tier: "default", activation: "enable", requiresConfig: "integrations", requiresPlanFlag: "integrations", pushableTemplateCodes: ["invoice", "receipt", "expense_receipt"] },
  { key: "finance-agent", name: "Finance agent", description: "An AI assistant with finance-specific tools: coding, rules, and pushes.", industry: "finance", tier: "default", activation: "enable" },
  { key: "statement-packs", name: "Statement packs", description: "Bank statements, purchase orders, remittance advice, and supplier statements.", industry: "finance", tier: "optional", activation: "enable", domainPack: "finance", optionalTemplateCodes: ["bank_statement", "purchase_order", "remittance_advice", "supplier_statement"] },
  // Dext-parity Phase 3 WP3.3: flipped to "enable" now that a real settings/expenses surface
  // exists — same request-until-there's-a-UI precedent as bank-match and approval-workflows.
  // "Publish" in the description still refers to a future accounting push, not built here.
  { key: "expense-approvals", name: "Expense approvals", description: "Submit, approve, and publish employee expense claims.", industry: "finance", tier: "optional", activation: "enable", navItems: [{ href: "expenses", label: "Expenses", icon: "receipt" }] },
  { key: "bank-match", name: "Bank matching", description: "Match statement lines to receipts automatically.", industry: "finance", tier: "optional", activation: "enable" },

  { key: "dictation", name: "Dictation", description: "Speech-to-structured-report dictation.", industry: "healthcare", tier: "default", activation: "enable", requiresConfig: "asr", navItems: [{ href: "dictation", label: "Dictation", icon: "mic" }] },
  { key: "clinical-packs", name: "Clinical packs", description: "Pathology report templates.", industry: "healthcare", tier: "default", activation: "enable", domainPack: "pathology" },
  { key: "hipaa-controls", name: "HIPAA controls", description: "BAA-covered ASR and ePHI handling controls.", industry: "healthcare", tier: "optional", activation: "request" },

  { key: "logistics-packs", name: "Logistics packs", description: "Bill of lading, packing list, and freight invoice templates.", industry: "logistics", tier: "default", activation: "enable", domainPack: "logistics" },

  { key: "construction-packs", name: "Construction packs", description: "Subcontractor invoice, lien waiver, delivery ticket, timesheet, and change order templates.", industry: "construction", tier: "default", activation: "enable", domainPack: "construction" },
]

export function findModule(key: string | null | undefined): ModuleDefinition | null {
  if (!key) return null
  return MODULES.find((module) => module.key === key) ?? null
}

/** Every module a workspace of this industry could ever have — core modules plus this industry's
 * own. A general workspace gets core only, since no rows below have industry "general". */
export function modulesForIndustry(industry: Industry): ModuleDefinition[] {
  return MODULES.filter((module) => module.industry === "core" || module.industry === industry)
}

export const INDUSTRIES: { key: Industry; label: string; description: string }[] = [
  { key: "finance", label: "Finance", description: "Bookkeeping and accounts payable: review, code, and push documents to your books." },
  { key: "healthcare", label: "Healthcare", description: "Dictate and structure clinical pathology reports." },
  { key: "construction", label: "Construction", description: "Subcontractor invoices, lien waivers, and job-cost documents." },
  { key: "logistics", label: "Logistics", description: "Bills of lading, packing lists, and freight invoices." },
  { key: "general", label: "General", description: "Documents, sheets, search, and reports — no industry-specific modules." },
]
