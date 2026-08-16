import { options } from "@/app/admin-next/next-admin-options"
import { requireAdminPage } from "@/lib/admin"
import { prisma } from "@/lib/db"
import type { PrismaClient } from "@premieroctet/next-admin"
// From the adapter entry point, not the package root. next-admin 8 is framework-agnostic and
// its components read the router through a context that a per-framework adapter installs —
// importing NextAdmin from the root renders it with no provider and throws
// "RouterAdapterProvider is not initialized" at the first hook call.
import { NextAdmin } from "@premieroctet/next-admin/adapters/next"
import { getNextAdminProps } from "@premieroctet/next-admin/appRouter"

export const dynamic = "force-dynamic"

/** The generated CRUD console.
 *
 * next-admin ships no authentication of its own — it renders whatever it is mounted on. The
 * guard is the same requireAdminPage() the hand-built console uses, and it is repeated in the
 * API route, because this page does not run when the browser calls that route directly. */
export default async function AdminNextPage({ params, searchParams }: {
  params: Promise<{ nextadmin?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminPage()
  const { nextadmin } = await params

  const props = await getNextAdminProps({
    params: nextadmin,
    searchParams: await searchParams,
    basePath: "/admin-next",
    apiBasePath: "/api/admin-next",
    options,
    // The generated client and the app's client are separate builds of the same schema, so the
    // structural types differ by nominal identity only.
    prisma: prisma as unknown as PrismaClient,
  })

  return <NextAdmin {...props} options={options} />
}
