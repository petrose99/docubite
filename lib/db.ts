import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** Maximum simultaneous database connections, when the default does not suit the server.
 *
 * Set this to 1 for a local `prisma dev` database. That server is PGlite, an embedded Postgres
 * that accepts exactly **one** connection: the second concurrent one is closed the moment it
 * opens, which Prisma reports as `P1017 Server has closed the connection`. Because it depends
 * on timing, it shows up as pages that fail intermittently and recover on a retry, which reads
 * like a network fault rather than a connection limit. A real Postgres wants the default. */
const poolMax = Number(process.env.DATABASE_POOL_MAX)

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ...(Number.isInteger(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
    // Poolers (PgBouncer, RDS Proxy, Neon) hang up on idle connections well inside pg's own
    // 10-minute default, after which the pool hands out a socket the server already closed.
    idleTimeoutMillis: 10_000,
  })
  // Do not enable Prisma query logging: bind values can contain document data.
  return new PrismaClient({
    adapter,
    /** Prisma's defaults for *interactive* transactions are maxWait 2s / timeout 5s, which are
     * comfortable against a real Postgres and much too tight against a local `prisma dev`
     * database: PGlite accepts a single connection, so a transaction queues behind whatever else
     * the request is doing and routinely spends its whole budget waiting to start. The symptom is
     * "A commit cannot be executed on an expired transaction … 5104 ms passed", which reads like
     * slow application code rather than contention for one socket.
     *
     * The app's own writes use the array form of $transaction, which is a single round trip and
     * never hit this. It surfaced through @premieroctet/next-admin's editor, which wraps its
     * writes in an interactive transaction. Raising the ceiling costs nothing when queries are
     * fast — these are timeouts, not delays. */
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
