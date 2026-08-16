/** Repairs the import specifiers @premieroctet/next-admin-generator-prisma writes on Windows.
 *
 * The generator rewrites next-admin's own `dist/utils/prisma-runtime.mjs` (and two type files) to
 * point at the client it just generated, and it builds that specifier with Node's platform path
 * join. On Windows that produces:
 *
 *     import { Prisma } from ".\..\generated\prisma/client.mjs"
 *
 * ESM specifiers are URLs, not filesystem paths, so a backslash is not a separator — Node reads
 * that as the bare package name `...generatedprisma/client.mjs` and throws
 * ERR_INVALID_MODULE_SPECIFIER before next-admin can load at all. On macOS and Linux the same
 * code produces forward slashes and the bug is invisible, which is why it ships.
 *
 * This runs after every `prisma generate` (see the db:generate and postinstall scripts) because
 * generation rewrites those files each time, undoing the fix. It is a no-op on POSIX and a no-op
 * when next-admin is not installed, so it is safe to leave in the pipeline unconditionally.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { glob } from "node:fs/promises"
import path from "node:path"

const DIST = path.join("node_modules", "@premieroctet", "next-admin", "dist")

/** Matches the specifier of a static import/export or a dynamic import() — the string literal
 * after `from`, `import`, or `export … from`. Deliberately narrow: only specifiers are rewritten,
 * never string contents elsewhere in the file, which could legitimately contain backslashes. */
const SPECIFIER = /((?:\bfrom|\bimport|\bexport\s+\*\s+from)\s*\(?\s*")([^"]+)(")/g

/** Prisma 7 deleted the `@prisma/client/runtime/library` entry point; the two error classes
 * next-admin imports from it now live in `@prisma/client/runtime/client`, which is a real
 * subpath in this version's exports map. Without this rewrite the data API route fails to build
 * with "Module not found: Can't resolve '@prisma/client/runtime/library'" — the console renders
 * its first page from server props and then every search, sort, paginate and save 500s.
 *
 * Verified against @prisma/client 7.8.0: runtime/client exports both PrismaClientKnownRequestError
 * and PrismaClientValidationError as functions. */
const PRISMA_RUNTIME = ["@prisma/client/runtime/library", "@prisma/client/runtime/client"]

async function main() {
  if (!existsSync(DIST)) return

  let paths = 0
  let runtimes = 0
  for await (const entry of glob(`${DIST.replaceAll("\\", "/")}/**/*.{mjs,js,d.ts}`)) {
    const source = readFileSync(entry, "utf8")
    let fixed = source

    if (fixed.includes("\\")) {
      const before = fixed
      fixed = fixed.replace(SPECIFIER, (match, lead, specifier, tail) =>
        specifier.includes("\\") ? `${lead}${specifier.replaceAll("\\", "/")}${tail}` : match,
      )
      if (fixed !== before) paths++
    }

    if (fixed.includes(PRISMA_RUNTIME[0])) {
      fixed = fixed.replaceAll(PRISMA_RUNTIME[0], PRISMA_RUNTIME[1])
      runtimes++
    }

    if (fixed !== source) writeFileSync(entry, fixed)
  }

  if (paths || runtimes) {
    console.log(`next-admin: normalised ${paths} import path(s), repointed ${runtimes} Prisma runtime import(s)`)
  }
}

await main()
