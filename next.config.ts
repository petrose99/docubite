import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    unoptimized: true, // FIXME: bug on prod, images always empty, investigate later
  },
  // Resolves its own native driver at runtime and must not be bundled.
  //
  // sharp: `next` itself carries a nested, older sharp as an optional dependency (for next/image,
  // which we don't use — images.unoptimized is true above). With two sharp versions in the tree,
  // Turbopack's function bundler traced/externalized the wrong native binary against the wrong JS
  // bindings, producing a version-mismatched libvips .so at runtime in production:
  // "ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file". Excluding sharp
  // from bundling makes it load straight out of node_modules at runtime instead, the same fix as
  // @prisma/adapter-pg for the same underlying reason (a native binary a JS bundler cannot trace
  // correctly).
  serverExternalPackages: ["@prisma/adapter-pg", "sharp"],
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
