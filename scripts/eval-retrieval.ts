import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/embeddings"
import { routeQuery } from "@/lib/query-router"
import { rrfFuse } from "@/lib/retrieval"
import { lexicalSearch, vectorSearch, type ChunkSearchRow } from "@/models/document-chunks"
import type { FieldFilter } from "@/models/document-field-values"
import { unscoped } from "@/lib/workspace-scope"
import fs from "fs"
import path from "path"

/** Retrieval eval harness: measures four retrieval arms against a fixture file so a change to
 * retrieval can be justified with numbers instead of an impression.
 *
 * The arms:
 *   vector      — the dense channel alone
 *   lexical     — the sparse channel alone
 *   hybrid      — RRF over both. THIS IS TODAY'S SHIPPED BEHAVIOUR and the baseline to beat.
 *   hybrid+router — the same, with the query first split into structured pre-filters plus a
 *                   semantic remainder.
 *
 * The bar for shipping the router on by default: hybrid+router must be >= hybrid on every metric,
 * and strictly better on exact_id and filtered. Anything less and the router is added latency and
 * an added LLM call for nothing.
 *
 * Usage:
 *   tsx --env-file .env scripts/eval-retrieval.ts --seed [--workspace <id>] [--domain finance]
 *       Writes evals/<domain>.jsonl from the documents actually in the database.
 *   tsx --env-file .env scripts/eval-retrieval.ts [--workspace <id>] [--domain finance] [--k 8]
 *       Runs the four arms over that fixture file and prints the table. */

const EVALS_DIR = path.join(process.cwd(), "evals")
const PER_HALF = 24

/** One eval case. `kind` selects which metric the case is diagnostic for:
 *   exact_id  — the query is (or contains) a literal identifier; the right document must rank FIRST.
 *   filtered  — the query states an exactly checkable constraint; every matching document must be found.
 *   semantic  — the query describes content in words the document does not necessarily use. */
type Fixture = { query: string; expectedDocumentIds: string[]; kind: "exact_id" | "semantic" | "filtered"; note?: string }

type Arm = "vector" | "lexical" | "hybrid" | "hybrid+router"

type Metrics = { cases: number; recallAtK: number; mrr: number; exactIdHitRate: number; exactIdCases: number }

function parseArgs() {
  const argv = process.argv.slice(2)
  const value = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  return { seed: argv.includes("--seed"), workspace: value("--workspace"), domain: value("--domain") ?? "finance", k: Number(value("--k") ?? 8) }
}

/** Collapses chunk hits to a ranked list of distinct document ids, best rank first. */
function toDocumentRanking(hits: { documentId: string }[]): string[] {
  const seen = new Set<string>()
  const ranking: string[] = []
  for (const hit of hits) {
    if (seen.has(hit.documentId)) continue
    seen.add(hit.documentId)
    ranking.push(hit.documentId)
  }
  return ranking
}

async function embedQuery(query: string): Promise<number[] | null> {
  try {
    const [vec] = await embedTexts([query], "query")
    return vec ?? null
  } catch {
    return null
  }
}

/** How each routed query resolved, tallied so the table can be read honestly. A router that failed
 * on every query scores IDENTICALLY to plain hybrid — its fallback is plain hybrid — so without
 * this the "no regression" line would look like evidence when it is really an absence of data. */
const routerHealth = new Map<string, number>()

/** Runs one arm for one query and returns the ranked document ids. */
async function runArm(arm: Arm, workspaceId: string, fixture: Fixture): Promise<string[]> {
  let query = fixture.query
  let filters: FieldFilter[] = []
  if (arm === "hybrid+router") {
    const routed = await routeQuery(workspaceId, fixture.query, { force: true })
    routerHealth.set(routed.via, (routerHealth.get(routed.via) ?? 0) + 1)
    filters = routed.filters
    query = routed.semanticQuery
  }

  if (arm === "lexical") return toDocumentRanking(await lexicalSearch(workspaceId, query, PER_HALF))
  if (arm === "vector") {
    const vec = await embedQuery(query)
    return vec ? toDocumentRanking(await vectorSearch(workspaceId, vec, PER_HALF)) : []
  }

  const vec = await embedQuery(query)
  const [lexicalHits, vectorHits] = await Promise.all([
    lexicalSearch(workspaceId, query, PER_HALF, filters),
    vec ? vectorSearch(workspaceId, vec, PER_HALF, filters) : Promise.resolve([] as ChunkSearchRow[]),
  ])
  return toDocumentRanking(rrfFuse([vectorHits, lexicalHits]))
}

function score(fixtures: Fixture[], rankings: string[][], k: number): Metrics {
  let recallSum = 0
  let mrrSum = 0
  let exactIdHits = 0
  let exactIdCases = 0
  fixtures.forEach((fixture, index) => {
    const topK = rankings[index].slice(0, k)
    const expected = new Set(fixture.expectedDocumentIds)
    // Recall@k: how much of the expected set the arm surfaced. For a "filtered" case this is the
    // completeness measure — a top-k retriever cannot score 1 here once the expected set exceeds k.
    recallSum += expected.size ? [...expected].filter((id) => topK.includes(id)).length / expected.size : 0
    const firstHit = rankings[index].findIndex((id) => expected.has(id))
    mrrSum += firstHit >= 0 ? 1 / (firstHit + 1) : 0
    if (fixture.kind === "exact_id") {
      exactIdCases++
      // Deliberately rank-1, not "in top k": if you name an invoice number, that invoice is the answer.
      if (rankings[index][0] && expected.has(rankings[index][0])) exactIdHits++
    }
  })
  return {
    cases: fixtures.length,
    recallAtK: fixtures.length ? recallSum / fixtures.length : 0,
    mrr: fixtures.length ? mrrSum / fixtures.length : 0,
    exactIdHitRate: exactIdCases ? exactIdHits / exactIdCases : 0,
    exactIdCases,
  }
}

/** Builds fixtures from the documents actually present, so the harness has something real to run
 * against before any hand-written domain queries exist. Hand-written cases can be appended to the
 * generated file; the seeder overwrites, so keep additions in a separate file or re-add them. */
async function seed(workspaceId: string, domain: string) {
  const documents = await prisma.document.findMany({
    where: { workspaceId, ocrText: { not: "" } },
    select: { id: true, filename: true, reviewedData: true, template: { select: { code: true } } },
  })
  if (!documents.length) throw new Error("no OCR'd documents in this workspace to seed fixtures from")

  const fixtures: Fixture[] = []
  const byVendor = new Map<string, string[]>()

  for (const document of documents) {
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const identifier = [values.invoice_number, values.receipt_number, values.accession_no, values.shipment_id].find((value) => typeof value === "string" && value)
    if (typeof identifier === "string") {
      fixtures.push({ query: identifier, expectedDocumentIds: [document.id], kind: "exact_id", note: `literal identifier from ${document.filename}` })
    }
    const vendor = [values.vendor, values.merchant, values.carrier].find((value) => typeof value === "string" && value)
    if (typeof vendor === "string") byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), document.id])

    const items = Array.isArray(values.line_items) ? (values.line_items as Record<string, unknown>[]) : []
    const description = items.map((item) => item.description).find((value) => typeof value === "string" && String(value).length > 6)
    if (typeof description === "string") {
      fixtures.push({ query: description, expectedDocumentIds: [document.id], kind: "semantic", note: `line item from ${document.filename}` })
    }
  }

  // One "filtered" case per vendor — the completeness question, expecting EVERY document from that
  // vendor rather than the best-looking one.
  for (const [vendor, ids] of byVendor) {
    fixtures.push({ query: `all invoices from ${vendor}`, expectedDocumentIds: ids, kind: "filtered", note: `${ids.length} document(s) from this vendor` })
  }

  fs.mkdirSync(EVALS_DIR, { recursive: true })
  const file = path.join(EVALS_DIR, `${domain}.jsonl`)
  fs.writeFileSync(file, fixtures.map((fixture) => JSON.stringify(fixture)).join("\n") + "\n", "utf8")
  console.info(`Wrote ${fixtures.length} fixture(s) to ${path.relative(process.cwd(), file)}`)
  for (const kind of ["exact_id", "semantic", "filtered"] as const) {
    console.info(`  ${kind}: ${fixtures.filter((fixture) => fixture.kind === kind).length}`)
  }
}

function loadFixtures(domain: string): Fixture[] {
  const file = path.join(EVALS_DIR, `${domain}.jsonl`)
  if (!fs.existsSync(file)) throw new Error(`no fixture file at ${path.relative(process.cwd(), file)} — run with --seed first`)
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Fixture)
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

async function main() {
  const args = parseArgs()
  // Genuinely cross-workspace: with no --workspace given, this picks whichever workspace has
  // documents. unscoped() marks that as deliberate rather than an oversight — the same escape
  // hatch auth, the admin console and the Stripe webhook use.
  const workspaceId = args.workspace ?? (await unscoped(() => prisma.document.findFirst({ select: { workspaceId: true } })))?.workspaceId
  if (!workspaceId) throw new Error("no workspace found — pass --workspace <id>")

  if (args.seed) return seed(workspaceId, args.domain)

  const fixtures = loadFixtures(args.domain)
  console.info(`Evaluating ${fixtures.length} ${args.domain} fixture(s) at k=${args.k} in workspace ${workspaceId}\n`)

  const arms: Arm[] = ["vector", "lexical", "hybrid", "hybrid+router"]
  const results = new Map<Arm, Metrics>()
  for (const arm of arms) {
    const rankings: string[][] = []
    for (const fixture of fixtures) rankings.push(await runArm(arm, workspaceId, fixture))
    results.set(arm, score(fixtures, rankings, args.k))
  }

  console.info(`${"arm".padEnd(15)}${`recall@${args.k}`.padStart(11)}${"MRR".padStart(9)}${"exact_id".padStart(11)}`)
  console.info("-".repeat(46))
  for (const arm of arms) {
    const metrics = results.get(arm)!
    console.info(`${arm.padEnd(15)}${pct(metrics.recallAtK).padStart(11)}${metrics.mrr.toFixed(3).padStart(9)}${pct(metrics.exactIdHitRate).padStart(11)}`)
  }

  // An empty index scores 0.0 on every arm, and "0 >= 0" would otherwise print as a clean pass.
  // A comparison between two arms that both found nothing is not evidence of anything, so the
  // verdict is withheld rather than reported green.
  const indexed = await prisma.documentChunk.count({ where: { workspaceId } })
  const anyHits = arms.some((arm) => results.get(arm)!.mrr > 0)
  if (!indexed || !anyHits) {
    console.info(`\nNO VERDICT: ${indexed ? `${indexed} chunk(s) indexed but every arm scored zero` : "this workspace has no indexed chunks"}.`)
    console.info("Every arm searched an empty result set, so these numbers compare nothing. Index the")
    console.info("documents (scripts/backfill-embeddings.ts, with EMBEDDINGS_BASE_URL configured) and re-run.")
    process.exitCode = 1
    return
  }

  const routedOk = routerHealth.get("llm") ?? 0
  const routerFailed = routerHealth.get("llm_failed") ?? 0
  console.info(`\nRouter: ${[...routerHealth.entries()].map(([via, count]) => `${via}=${count}`).join(" ")}`)
  if (!routedOk) {
    console.info("NO VERDICT on the router: it produced filters for zero queries, so its arm is just")
    console.info(`hybrid with a fallback${routerFailed ? " (the model call failed — check the API quota)" : ""}. Fix that before reading its row.`)
    return
  }

  // The ship gate, evaluated rather than eyeballed.
  const hybrid = results.get("hybrid")!
  const routed = results.get("hybrid+router")!
  const noWorse = routed.recallAtK >= hybrid.recallAtK && routed.mrr >= hybrid.mrr && routed.exactIdHitRate >= hybrid.exactIdHitRate
  const better = routed.exactIdHitRate > hybrid.exactIdHitRate || routed.recallAtK > hybrid.recallAtK
  console.info(`\nRouter vs hybrid: ${noWorse ? (better ? "no regression, and better on the targeted metrics" : "no regression, but no measured gain either") : "REGRESSION — do not enable the router"}`)
  if (!hybrid.exactIdCases) console.info("(no exact_id cases in this fixture set, so that column is not meaningful)")
}

main()
  .catch((error) => {
    console.error("Eval failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
