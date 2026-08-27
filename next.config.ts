import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  async headers() {
    // Baseline browser protections. The Content-Security-Policy itself lives in proxy.ts now, not
    // here: an enforced, nonce-based script-src has to be generated per-request (a fresh nonce
    // every time) and threaded through as the `x-nonce` request header Next.js auto-applies to the
    // scripts it injects — see lib/csp.ts. A static header here cannot carry a per-request value.
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // camera is allowed as of WP13's mobile capture flow (components/extract/camera-capture) —
        // every other capability here is still unused by anything in the app and stays denied.
        { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }]
  },
  images: {
    unoptimized: true, // FIXME: bug on prod, images always empty, investigate later
  },
  // Resolves its own native driver at runtime and must not be bundled.
  //
  // sharp is ALREADY externalized by Next.js's own default server-external-packages list, so
  // adding it here changed nothing (confirmed: identical ERR_DLOPEN_FAILED before and after). The
  // real problem is downstream of that: sharp's file tracer (@vercel/nft) determines which
  // node_modules files ride along in the deployed serverless function by statically following
  // require()/import calls, but sharp loads its native libvips-cpp.so via a runtime dlopen — not a
  // traceable static reference — so nft under-includes it and the .so is simply missing from the
  // deployed bundle. Confirmed NOT a stale-cache or duplicate-version issue: identical failure
  // survived a from-scratch rebuild with zero cache and a deduped single sharp version (see the
  // package.json override). outputFileTracingIncludes below force-includes the files nft misses,
  // which is the documented fix for this exact class of native-addon tracing gap.
  serverExternalPackages: ["@prisma/adapter-pg", "sharp"],
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  experimental: {
    serverActions: {
      // Matches config.documents.maxFileSizeBytes (50MB) plus overhead for multipart framing —
      // not the 256mb this used to be. Uploads go through uploadDocumentsAction one file per
      // request (see extract-panel.tsx's uploadRows), so this never needs to cover a batch.
      // A limit far past the app's own file-size ceiling was needless DoS and exfiltration
      // surface on every server action, not just uploads.
      bodySizeLimit: "52mb",
    },
  },
}

const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT

export default isSentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: !process.env.CI,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      disableLogger: true,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
    })
  : nextConfig
