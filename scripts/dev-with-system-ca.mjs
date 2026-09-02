// Local dev-only wrapper: some networks (corporate TLS-inspecting proxies) intercept HTTPS to
// third-party hosts like Supabase with a CA Node's bundled trust store doesn't know. Node's
// --use-system-ca flag makes it also trust the OS certificate store, which usually has that CA.
// Not part of the committed "dev" script since it's an environment workaround, not something
// every contributor needs.
import { spawn } from "node:child_process"
import path from "node:path"

process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ")

const nextBin = path.join(import.meta.dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next")

const child = spawn(nextBin, ["dev", "--turbopack"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
})
child.on("exit", (code) => process.exit(code ?? 0))
