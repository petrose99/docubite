import { TaxRegionPicker } from "@/components/workspace/tax-region-picker"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { TAX_REGION_LIST } from "@/lib/tax/regions"
import { getTaxProfile } from "@/models/tax-profiles"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

/** Tax settings: which region this workspace files in, and the rate/registration facts that
 * follow from it. Finance-industry only (WP2) — a non-finance workspace has no tax profile to set. */
export default async function TaxSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!(await getWorkspaceCapabilities(workspaceId)).has("tax-profiles")) notFound()

  const profile = await getTaxProfile(workspaceId)
  const owner = membership.role === "owner"

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Tax</h1>
      <p className="mt-1 text-muted-foreground">The region this workspace files in — its currency, tax rates, and registration number format.</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Region</CardTitle>
        <CardDescription>Changing this creates a new tax profile version; past documents keep whatever was in force when they were checked.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {owner
          ? <TaxRegionPicker
              workspaceId={workspaceId}
              regions={TAX_REGION_LIST.map((region) => ({ code: region.region, name: region.name, currency: region.currency }))}
              current={(profile?.region as (typeof TAX_REGION_LIST)[number]["region"]) ?? null} />
          : <p className="text-sm">Tax region is set by the workspace owner.</p>}

        {profile && <div className="space-y-2 rounded border p-4 text-sm">
          <p><span className="font-medium">Currency:</span> {profile.config.currency}</p>
          <p><span className="font-medium">{profile.config.registrationNumberLabel}</span> format: <code className="rounded bg-stone-100 px-1.5 py-0.5">{profile.config.registrationNumberPattern}</code></p>
          {profile.config.rates.length > 0 && <div>
            <span className="font-medium">Rates:</span>
            <ul className="mt-1 list-inside list-disc">
              {profile.config.rates.map((rate) => <li key={rate.label}>{rate.label}: {(rate.rate * 100).toFixed(0)}% (from {rate.effectiveFrom})</li>)}
            </ul>
          </div>}
          {profile.config.rates.length === 0 && <p className="text-muted-foreground">This region&apos;s rates are set at the state/local level and are not modeled here yet.</p>}
        </div>}
      </CardContent>
    </Card>
  </main>
}
