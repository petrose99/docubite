import { SettingsNav } from "@/components/shell/settings-nav"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { requireWorkspaceRole } from "@/models/workspaces"

/** Narrow reading column for the document detail and settings pages. Top-level navigation lives
 * in the app shell's sidebar one level up, which collapses every settings destination to a single
 * "Settings" entry — SettingsNav renders those destinations as tabs here instead (it no-ops on a
 * non-settings route, e.g. a document detail page). */
export default async function WorkspaceChromeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  const capabilities = await getWorkspaceCapabilities(workspaceId)
  return <div className="mx-auto w-full max-w-4xl p-6">
    <SettingsNav workspaceId={workspaceId} enabledModuleKeys={[...capabilities.enabled]} integrationsEnabled={config.integrations.enabled} />
    {children}
  </div>
}
