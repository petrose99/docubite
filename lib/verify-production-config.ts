import config from "@/lib/config"

type ConfigCheck = { name: string; ok: boolean; detail: string }

/** Configuration that must be right before a production process is allowed to serve traffic or
 * process jobs. Distinct from the placeholder/unset guard already in lib/config.ts (secrets that
 * would otherwise boot with a publicly-known default) — these are correctness checks on top of
 * that: settings that boot fine but leave a hole open until something notices in production. */
function hardChecks(): ConfigCheck[] {
  const checks: ConfigCheck[] = [
    {
      name: "DB_SCOPE_GUARD",
      ok: config.isolation.scopeGuard === "throw",
      detail: 'must be "throw" in production — a query missing a workspaceId filter would otherwise only log a warning instead of failing, and could return another tenant\'s rows',
    },
    {
      name: "MALWARE_SCAN_URL",
      ok: Boolean(config.aws.malwareScanUrl),
      detail: "unset — uploaded documents are accepted without a malware scan",
    },
  ]
  return checks
}

/** Configuration that is worth a loud warning but not worth refusing to boot over — the app
 * still works without it, just with a feature quietly degraded (no error monitoring, no plan
 * limits) rather than an outage. */
function softChecks(): ConfigCheck[] {
  return [
    {
      name: "NEXT_PUBLIC_SENTRY_DSN",
      ok: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
      detail: "unset — production errors will not be reported to Sentry",
    },
  ]
}

/** Fail-fast production sanity check. Run once at process boot (instrumentation.ts's register()
 * for the web process, worker/job-worker.ts's startup for the worker) rather than left to surface
 * later as a security gap nobody was looking for, or a 500 on whichever request first needed the
 * missing setting.
 *
 * A no-op outside production: every check here is about what a live deployment must have, not
 * about local dev or CI, which already run under their own defaults. */
export function verifyProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return

  const failed = hardChecks().filter((check) => !check.ok)
  if (failed.length) {
    throw new Error(`Refusing to start in production with invalid configuration — ${failed.map((check) => `${check.name} (${check.detail})`).join("; ")}.`)
  }

  for (const check of softChecks()) {
    if (!check.ok) console.warn(`[production-config] ${check.name}: ${check.detail}`)
  }
}
