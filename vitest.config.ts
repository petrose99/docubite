import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "forms/**/*.test.ts", "models/**/*.test.ts", "worker/**/*.test.ts", "ai/**/*.test.ts"],
    // SECRETS_ENCRYPTION_KEY is a fixed test-only key (never used outside vitest) so tests that
    // round-trip lib/secret-crypto.ts (webhook secrets, integration OAuth tokens) don't each need
    // their own env plumbing before config.ts is first imported.
    env: { BASE_URL: "http://localhost:7331", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
  },
  resolve: {
    // Order matters: rollup's alias plugin tries entries in sequence, so the specific
    // "@/prisma/client" entry has to come before the generic "@" prefix or it never gets a
    // chance to match. Mirrors tsconfig.json's own "paths" override — the generated client has no
    // index.ts, so the generic alias resolves it to a bare directory with nothing to import. That
    // was invisible until now because every prior test importing it used Prisma only as a type
    // (esbuild elides a type-only import, so the broken resolution path was never exercised) or
    // mocked the whole module that contained it. models/files.ts uses Prisma.JsonNull as a real
    // runtime value, so its import survives compilation and needs to actually resolve.
    alias: [
      { find: "@/prisma/client", replacement: path.resolve(__dirname, "prisma/client/client") },
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
})
