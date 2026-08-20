import config from "@/lib/config"
import type { DictationExtraction } from "@/lib/dictation/extraction"
import { DEFAULT_FORMAT_NAME, resolveFormat, type DictationFormat } from "@/lib/dictation/formats"
import type { DictationRoute } from "@/lib/dictation/intents"
import type { RoutedIntent } from "@/lib/dictation/router"

/** The single resolution point both entry points converge on (see the plan: "a short-circuit at
 * the front of one pipeline, not a fork"). Pure and synchronous — every input has already been
 * produced by an earlier, independently-failable step (template lookup, the embedding router,
 * Stage B extraction), so resolving them into one decision cannot itself fail or need a fallback of
 * its own; it just applies the override rule.
 *
 * Template mode's short-circuit means it never calls routeDictation at all — the caller constructs
 * `routed` as `{ intent: "template", route: null, score: 0, via: "template" }` and passes the
 * template's own default format as `preselectedTemplateFormat`. Agnostic mode passes the real
 * routeDictation() result and no `preselectedTemplateFormat`.
 *
 * Precedence, matching the brief's override rule exactly:
 *   1. An explicitly spoken format (Stage B, format_source === "explicit") always wins — it beats
 *      both a pre-selected template's default and the router's default, because a person correcting
 *      the system out loud is the strongest signal there is.
 *   2. Otherwise, a pre-selected template's own default format, when the caller has one.
 *   3. Otherwise, the matched route's default format.
 *   4. Otherwise, the registry default ("narrative"). */
export type DictationRouting = {
  intent: string
  format: DictationFormat
  formatSource: "explicit" | "template_default" | "route_default" | "fallback_default"
  routeScore: number
  routeVia: RoutedIntent["via"]
  commands: string[]
}

export function resolveDictationRouting(input: {
  /** Present (even if null) only when the entry point was a pre-selected template. */
  preselectedTemplateFormat?: string | null
  routed: RoutedIntent
  extraction: DictationExtraction
}): DictationRouting {
  const { preselectedTemplateFormat, routed, extraction } = input
  const base = { intent: routed.intent, routeScore: routed.score, routeVia: routed.via, commands: extraction.commands }

  if (extraction.format_source === "explicit" && extraction.requested_format) {
    return { ...base, format: resolveFormat(extraction.requested_format), formatSource: "explicit" }
  }
  if (preselectedTemplateFormat !== undefined) {
    return { ...base, format: resolveFormat(preselectedTemplateFormat ?? DEFAULT_FORMAT_NAME), formatSource: "template_default" }
  }
  if (routed.route) {
    return { ...base, format: resolveFormat(routed.route.defaultFormat), formatSource: "route_default" }
  }
  return { ...base, format: resolveFormat(DEFAULT_FORMAT_NAME), formatSource: "fallback_default" }
}

export type { DictationFormat, DictationRoute }

/** Stage 4 — the confidence gate. How close a router score has to sit to the configured threshold,
 * on either side, to count as a near-miss rather than a clean decision. Calibrated off the same
 * live measurement as the threshold itself (lib/config.ts): the six on-topic dictations scored
 * 0.675-0.785 and the one clearly off-topic ramble scored 0.441 — a margin of 0.05 sits well inside
 * the on-topic cluster (catching a genuine toss-up between two routes) without reaching anywhere
 * near the ramble's score (never asking about a dictation the router is actually confident about). */
export const AMBIGUITY_MARGIN = 0.05

export type AmbiguityCheck = { ambiguous: boolean; reason: "intent" | "format" | null }

/** Never guess when genuinely unsure — see the brief's confidence/ambiguity gate. Two distinct ways
 * a resolution can be a guess rather than a decision:
 *
 * - "intent": the router actually ran (via is "matched" or "below_threshold" — i.e. embeddings were
 *   available and a real comparison happened) and the winning score landed within AMBIGUITY_MARGIN
 *   of the threshold on either side. A score of 0.70 against a 0.65 threshold barely cleared it; a
 *   score of 0.62 barely missed. Both are the router essentially flipping a coin, not a clean call.
 * - "format": nothing else determined the format either — no explicit spoken format, no
 *   pre-selected template, no matched route. The registry default ("narrative") was the only thing
 *   left to fall back to, which is a guess by construction, not a decision from any signal.
 *
 * A dictation that is BOTH is reported as "intent" — knowing what task type it is would very likely
 * resolve the format questions too, so that is the more useful single question to ask. */
export function checkDictationAmbiguity(routing: DictationRouting): AmbiguityCheck {
  const routerRan = routing.routeVia === "matched" || routing.routeVia === "below_threshold"
  if (routerRan && Math.abs(routing.routeScore - config.dictation.routeThreshold) <= AMBIGUITY_MARGIN) {
    return { ambiguous: true, reason: "intent" }
  }
  if (routing.formatSource === "fallback_default") return { ambiguous: true, reason: "format" }
  return { ambiguous: false, reason: null }
}

/** The shape lib/document-transcription.ts::applyDictationRouting persists onto
 * `Document.dictationRouting`. Kept here, next to resolveDictationRouting, so the one function that
 * writes it and the readers that parse it back (models/report-drafts.ts, the verify screen's
 * server page) share the same contract instead of three independent guesses at its shape. */
export type PersistedDictationRouting = {
  intent: string
  format: string
  formatLabel: string
  formatSource: string
  routeScore: number
  routeVia: string
  commands: string[]
  needsClarification: boolean
  clarificationReason: "intent" | "format" | null
}

/** Reads a Document.dictationRouting JSON value back defensively — it is a display/lookup aid
 * written by a feature that can be toggled off or changed shape over time, never a value anything
 * downstream can assume is present or well-formed. A mismatch degrades to null rather than
 * throwing, exactly like every other reader of raw LLM-adjacent JSON in this codebase. */
export function parseDictationRoutingRecord(raw: unknown): PersistedDictationRouting | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  if (typeof source.intent !== "string" || typeof source.format !== "string") return null
  return {
    intent: source.intent,
    format: source.format,
    formatLabel: typeof source.formatLabel === "string" ? source.formatLabel : source.format,
    formatSource: typeof source.formatSource === "string" ? source.formatSource : "inferred",
    routeScore: typeof source.routeScore === "number" ? source.routeScore : 0,
    routeVia: typeof source.routeVia === "string" ? source.routeVia : "",
    commands: Array.isArray(source.commands) ? source.commands.filter((entry): entry is string => typeof entry === "string") : [],
    needsClarification: source.needsClarification === true,
    clarificationReason: source.clarificationReason === "intent" || source.clarificationReason === "format" ? source.clarificationReason : null,
  }
}
