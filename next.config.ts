import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
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
      bodySizeLimit: "256mb",
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
