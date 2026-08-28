import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ModuleRow } from "@/components/workspace/module-row"
import { getCurrentUser } from "@/lib/auth"
import { modulesForIndustry } from "@/lib/modules"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { getWorkspaceModuleOverrides } from "@/models/modules"
import { requireWorkspaceRole } from "@/models/workspaces"
import type { Industry } from "@/types/industry"

export const dynamic = "force-dynamic"

/** The modules catalog: every module this workspace's industry could have, split into what's
 * already Included (core + this industry's "always"/"default" modules) and what's Optional. Reads
 * like a product page rather than a settings table — a card per module, instant-feedback toggle,
 * "hides features, never deletes data" framing (nothing here is a destructive action; disabling a
 * module only stops it from showing up, exactly like turning the sidebar entry off would). */
export default async function ModulesCatalogPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const owner = membership.role === "owner"
  const industry = membership.workspace.industry as Industry

  const [capabilities, overrideRows] = await Promise.all([
    getWorkspaceCapabilities(workspaceId),
    getWorkspaceModuleOverrides(workspaceId),
  ])
  const overrides = new Map(overrideRows.map((row) => [row.moduleKey, row]))
  const candidates = modulesForIndustry(industry)
  const included = candidates.filter((module) => module.tier === "always" || (module.tier === "default" && capabilities.has(module.key)))
  const turnedOff = candidates.filter((module) => module.tier === "default" && !capabilities.has(module.key))
  const optional = candidates.filter((module) => module.tier === "optional")

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Modules</h1>
      <p className="mt-1 text-muted-foreground">What&apos;s turned on for this {industry} workspace. Turning a module off hides it — it never deletes any data already in it.</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Included</CardTitle>
        <CardDescription>On by default for a {industry} workspace.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y-0">
        {[...included, ...turnedOff].map((module) => (
          <ModuleRow
            key={module.key}
            workspaceId={workspaceId}
            moduleKey={module.key}
            name={module.name}
            description={module.description}
            kind={module.tier === "optional" ? "optional" : "default"}
            enabled={capabilities.has(module.key)}
            owner={owner}
            activation={module.activation}
            requestedBy={null}
          />
        ))}
      </CardContent>
    </Card>

    {optional.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Optional</CardTitle>
        <CardDescription>Not on by default — enable one, or ask the workspace owner to.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y-0">
        {optional.map((module) => {
          const override = overrides.get(module.key)
          return <ModuleRow
            key={module.key}
            workspaceId={workspaceId}
            moduleKey={module.key}
            name={module.name}
            description={module.description}
            kind="optional"
            enabled={capabilities.has(module.key)}
            owner={owner}
            activation={module.activation}
            requestedBy={override?.status === "requested" && override.requestedBy ? override.requestedBy : null}
          />
        })}
      </CardContent>
    </Card>}
  </main>
}
