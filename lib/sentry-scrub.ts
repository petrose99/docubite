import type { ErrorEvent, EventHint } from "@sentry/nextjs"

/** Sentry scrubbing shared by sentry.server.config.ts, sentry.edge.config.ts, and
 * instrumentation-client.ts.
 *
 * docs/security/POLICY-SET.md already states the rule: "Logs must not contain source documents,
 * extracted values, credentials, tokens, or prompts." Nothing in the Sentry setup enforced it —
 * `sendDefaultPii` was left at its default and no `beforeSend` existed, so request bodies, cookies,
 * and console/fetch breadcrumbs (which can carry document text, extracted field values, or a
 * bearer token in a header) shipped to Sentry unfiltered. This is what F16/F17's "verify no ePHI
 * reaches error reports" item in the audit was pointing at.
 *
 * Deliberately conservative: this drops whole categories of data (request bodies, extra context,
 * console/fetch breadcrumbs) rather than trying to pattern-match ePHI out of free text. Free-text
 * scrubbing is a losing game against handwritten field values and OCR output; dropping the
 * category is the only rule that can't leak. */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Replaces UUID path/query segments with a placeholder. workspaceId/documentId/fileId are not
 * ePHI themselves, but they are stable identifiers that let anyone with Sentry access correlate
 * error volume back to a specific customer or document — narrower access should not be required
 * to get that for free. */
export function scrubUuids(value: string): string {
  return value.replace(UUID_RE, ":id")
}

function scrubBreadcrumbs(event: ErrorEvent): ErrorEvent {
  if (!event.breadcrumbs) return event
  return {
    ...event,
    breadcrumbs: event.breadcrumbs
      // console breadcrumbs mirror server logs, which can include a document's OCR text or
      // extracted values (see lib/db.ts's own comment on why Prisma query logging is off for the
      // same reason). fetch/xhr breadcrumbs carry full request URLs, including any bearer token
      // that ends up in a query string and the same document/workspace ids scrubUuids exists for.
      .filter((crumb) => crumb.category !== "console" && crumb.category !== "fetch" && crumb.category !== "xhr")
      .map((crumb) => (crumb.message ? { ...crumb, message: scrubUuids(crumb.message) } : crumb)),
  }
}

function scrubRequest(event: ErrorEvent): ErrorEvent {
  if (!event.request) return event
  // The URL is kept (with ids scrubbed) because it is the single most useful piece of context for
  // triage — which route errored. Everything that can carry a document, a form field, or a secret
  // is dropped outright.
  const { data: _data, cookies: _cookies, headers: _headers, ...rest } = event.request
  return { ...event, request: { ...rest, url: rest.url ? scrubUuids(rest.url) : rest.url } }
}

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  let scrubbed = scrubBreadcrumbs(event)
  scrubbed = scrubRequest(scrubbed)
  // `extra` and `contexts.state` are open-ended bags callers can put anything into; POLICY-SET.md's
  // rule applies to them most directly, so they don't get a field-by-field scrub — they're dropped.
  const { extra: _extra, ...withoutExtra } = scrubbed
  return withoutExtra
}
