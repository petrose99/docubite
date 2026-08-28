import { BaaCoverageToggle } from "@/app/admin-next/baa/baa-toggle"
import { requireAdminPage } from "@/lib/admin"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

/** BAA coverage for clinical dictation, one row per hipaaMode workspace.
 *
 * A sibling of the generated /admin-next console, not a tab inside it: confirming coverage has to
 * write an AdminAuditEvent, which next-admin's field editor cannot do (see next-admin-options.ts's
 * header) — this is the one thing about Workspace that needs its own page instead. Only hipaaMode
 * workspaces are listed: asrExternalAllowed is inert for any other workspace (lib/asr/gating.ts
 * only ever consults it once industry is "healthcare" and hipaaMode is on). */
export default async function BaaCoveragePage() {
  await requireAdminPage()

  const workspaces = await prisma.workspace.findMany({
    where: { hipaaMode: true },
    select: { id: true, name: true, asrExternalAllowed: true },
    orderBy: { name: "asc" },
  })

  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <header>
      <h1 className="text-2xl font-bold text-stone-900">BAA coverage</h1>
      <p className="mt-1 text-sm text-stone-600">
        Every hipaaMode workspace, and whether a signed BAA covering the deployment&apos;s external ASR provider has
        been confirmed for it. Dictation is blocked for a workspace here until this is checked.
      </p>
    </header>

    {workspaces.length === 0
      ? <p className="text-sm text-stone-500">No hipaaMode workspaces yet.</p>
      : <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-stone-500">
              <th className="py-2 pr-4 font-medium">Workspace</th>
              <th className="py-2 font-medium">BAA coverage</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.id} className="border-b last:border-0">
                <td className="py-2 pr-4">{workspace.name}</td>
                <td className="py-2"><BaaCoverageToggle workspaceId={workspace.id} allowed={workspace.asrExternalAllowed} /></td>
              </tr>
            ))}
          </tbody>
        </table>}
  </main>
}
