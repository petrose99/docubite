import { describe, expect, it, vi } from "vitest"
import fs from "fs"
import path from "path"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
vi.mock("@/lib/config", () => ({ default: { ai: { provider: "gemini", geminiApiKey: "", geminiModelName: "m", openaiApiKey: "", openaiModelName: "" } } }))

const { DRAFT_BANNER, renderReportText } = await import("@/models/report-drafts")

const repoFile = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8")

describe("renderReportText", () => {
  const sections = [{ key: "gross", title: "Gross description" }, { key: "micro", title: "Microscopic" }]
  const narrative = { gross: "Received fresh.", micro: "Sheets of tumour cells." }

  it("stamps an unsigned draft with the banner, as the FIRST thing in the text", () => {
    const text = renderReportText({ signed: false, synopticText: "Diagnosis: IDC", narrative, sections })
    expect(text.startsWith(DRAFT_BANNER)).toBe(true)
    expect(DRAFT_BANNER).toContain("NOT FOR CLINICAL USE")
  })

  it("puts the banner in the TEXT, so it survives copy-paste and export", () => {
    // A banner that is only UI chrome disappears the moment someone copies the report out, which
    // is precisely when a draft is most likely to be mistaken for a final one.
    const text = renderReportText({ signed: false, synopticText: "Diagnosis: IDC", narrative, sections })
    expect(text.includes(DRAFT_BANNER)).toBe(true)
  })

  it("drops the banner only when signed", () => {
    const text = renderReportText({ signed: true, synopticText: "Diagnosis: IDC", narrative, sections })
    expect(text).not.toContain(DRAFT_BANNER)
    expect(text).toContain("Diagnosis: IDC")
  })

  it("emits sections in template order and omits ones with no text", () => {
    const text = renderReportText({ signed: true, synopticText: "", narrative: { gross: "Received fresh." }, sections })
    expect(text).toContain("GROSS DESCRIPTION")
    expect(text).not.toContain("MICROSCOPIC")
  })
})

/** These assert a security property by reading the source, which is unusual but deliberate: the
 * claim being defended is "no OTHER code path can sign a report", and that is a claim about the
 * whole repository rather than about any one function's behaviour. A unit test of signReport can
 * only show that signReport works. */
describe("sign-off is reachable from exactly one place", () => {
  it("only models/report-drafts.ts ever writes status \"signed\"", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git" || entry.name === ".claude") continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue
        const source = fs.readFileSync(full, "utf8")
        // A write of the literal signed status, as a Prisma data value.
        if (/status:\s*["']signed["']/.test(source)) offenders.push(path.relative(process.cwd(), full))
      }
    }
    walk(path.join(process.cwd(), "app"))
    walk(path.join(process.cwd(), "lib"))
    walk(path.join(process.cwd(), "models"))
    walk(path.join(process.cwd(), "components"))
    expect(offenders).toEqual(["models\\report-drafts.ts".replace(/\\/g, path.sep)])
  })

  it("the migration constrains status and forbids a signed row with no signer", () => {
    const migration = repoFile("prisma/migrations/20260819160000_add_dictation_and_reports/migration.sql")
    // The database backs the invariant up, so it does not rely on every future code path
    // remembering it.
    expect(migration).toContain(`CHECK ("status" IN ('draft', 'signed'))`)
    expect(migration).toMatch(/"status" = 'signed'\s+AND "signed_by_id" IS NOT NULL AND "signed_at" IS NOT NULL/)
    expect(migration).toMatch(/"status" = 'draft'\s+AND "signed_by_id" IS NULL AND "signed_at" IS NULL/)
  })

  it("drafts are created as \"draft\" and never as anything else", () => {
    const source = repoFile("models/report-drafts.ts")
    expect(source).toContain(`status: "draft"`)
    // The only "signed" write is inside signReport.
    const signedWrites = source.match(/status:\s*"signed"/g) ?? []
    expect(signedWrites).toHaveLength(1)
    expect(source.indexOf(`status: "signed"`)).toBeGreaterThan(source.indexOf("export async function signReport"))
  })

  it("the sign-off action requires an authenticated member and cannot take a null actor", () => {
    const source = repoFile("app/(app)/workspaces/[workspaceId]/report-actions.ts")
    expect(source).toContain("const user = await getCurrentUser()")
    expect(source).toContain("requireMember(workspaceId, user.id)")
    // updateDocumentField deliberately accepts actorId: null for link-shared editors. Sign-off
    // must not: an unattributable signature is a contradiction.
    expect(source).not.toContain("getViewerUser")
    expect(source).not.toContain("actorId: null")
  })
})
