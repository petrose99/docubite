// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { scrubEvent } from "@/lib/sentry-scrub"
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  // 1 (100%) is fine for a low-volume server, and full tracing is worth having while the app is
  // small — but it means every request's URL and timing lands in Sentry, so scrubEvent below is
  // what makes that acceptable rather than the sample rate itself. Revisit downward once traffic
  // volume makes 100% tracing costly.
  tracesSampleRate: 1,

  // Explicit rather than relying on the (already-false) default: this is the switch that would
  // attach IP address and other request PII to every event if ever flipped, so its value should
  // be visible here, not implied.
  sendDefaultPii: false,

  beforeSend: scrubEvent,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
})
