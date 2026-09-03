// Local dev-only wrapper: some networks (corporate TLS-inspecting proxies) intercept HTTPS to
// third-party hosts like Supabase with a CA Node's bundled trust store doesn't know. Node's
// --use-system-ca flag makes it also trust the OS certificate store, which usually has that CA.
// Not part of the committed "dev" script since it's an environment workaround, not something
// every contributor needs.
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"

// Turbopack's persistent cache can hold stale module-resolution results after new files are added,
// causing "Module not found" errors that only a manual .next delete would fix. Clearing it on every
// cold start is cheap (Turbopack rebuilds in seconds) and prevents the class of bug entirely.
const dotNext = path.join(import.meta.dirname, "..", ".next")
await rm(dotNext, { recursive: true, force: true }).catch(() => {})

process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ")

const nextBin = path.join(import.meta.dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next")

const child = spawn(nextBin, ["dev", "--turbopack"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
})
child.on("exit", (code) => process.exit(code ?? 0))
