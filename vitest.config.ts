import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "forms/**/*.test.ts", "models/**/*.test.ts", "worker/**/*.test.ts", "ai/**/*.test.ts"],
    env: { BASE_URL: "http://localhost:7331" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
