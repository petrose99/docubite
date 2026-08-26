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
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
