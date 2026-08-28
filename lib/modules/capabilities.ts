import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { getWorkspacePlan } from "@/lib/plans"
import { MODULES, modulesForIndustry, type ModuleDefinition } from "@/lib/modules"
import type { Industry } from "@/types/industry"
import { cache } from "react"

export type ModuleOverride = "enabled" | "disabled" | "requested"
type DeploymentConfig = { asr: boolean; integrations: boolean; embeddings: boolean }
type PlanFlags = { integrations: boolean }

/** Whether a module's requiresConfig prerequisite is satisfied by this deployment — independent of
 * industry/tier/overrides, which is why it's checked separately from those. A module with no
 * requiresConfig always passes. */
function configSatisfied(module: ModuleDefinition, deployment: DeploymentConfig): boolean {
  return !module.requiresConfig || deployment[module.requiresConfig]
}

/** Whether a module's requiresPlanFlag prerequisite is satisfied by the workspace's subscription
 * plan — same semantics as workspaceIntegrationsPlanEnabled (models/integrations.ts). */
function planSatisfied(module: ModuleDefinition, plan: PlanFlags): boolean {
  return !module.requiresPlanFlag || plan[module.requiresPlanFlag]
}

/** Pure: resolves the set of modules enabled for a workspace. Unit-testable without a database —
 * see lib/modules/capabilities.test.ts.
 *
 * - Starts from modulesForIndustry(industry): every "always" module, plus every "default" module.
 * - An override only ever applies to a module belonging to THIS industry (or "core") — a stray
 *   WorkspaceModule row left over from a workspace's previous industry (see setIndustry's lock,
 *   which normally prevents this, but overrides are cheap to filter defensively) is ignored.
 * - "enabled": turns on an optional-tier module of this industry. Meaningless (and ignored) for
 *   an always/default module, which is already on.
 * - "disabled": turns off a default-tier module. An "always" module cannot be disabled — the whole
 *   point of that tier — so a disabled override on one is ignored.
 * - "requested": adds no capability; it's provenance for the catalog UI only.
 * - Finally, drop anything failing its requiresConfig/requiresPlanFlag gate, regardless of tier —
 *   an "always" module gated on missing config still doesn't work, it just can't be turned off. */
export function resolveModules(
  industry: Industry,
  overrides: Map<string, ModuleOverride>,
  deployment: DeploymentConfig,
  plan: PlanFlags,
): ModuleDefinition[] {
  const candidates = modulesForIndustry(industry)
  const enabled = candidates.filter((module) => {
    const belongsToThisIndustry = module.industry === "core" || module.industry === industry
    const override = belongsToThisIndustry ? overrides.get(module.key) : undefined
    if (module.tier === "always") return true
    if (module.tier === "default") return override !== "disabled"
    // optional
    return override === "enabled"
  })
  return enabled.filter((module) => configSatisfied(module, deployment) && planSatisfied(module, plan))
}

export type WorkspaceCapabilities = {
  industry: Industry
  enabled: Set<string>
  has: (key: string) => boolean
  pushableTemplateCodes: string[]
}

/** The single gate everything else reads. React `cache()`-wrapped like getWorkspaceMembership:
 * module toggles are rare, owner-only admin actions (revalidatePath on mutation), not something
 * racing a mutation within the same request the way isWorkspaceLimitExempt's callers are. */
export const getWorkspaceCapabilities = cache(async (workspaceId: string): Promise<WorkspaceCapabilities> => {
  const [workspace, overrideRows] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { industry: true, subscription: { select: { planCode: true } } } }),
    prisma.workspaceModule.findMany({ where: { workspaceId }, select: { moduleKey: true, status: true } }),
  ])
  const industry = workspace.industry as Industry
  const overrides = new Map(overrideRows.map((row) => [row.moduleKey, row.status as ModuleOverride]))
  const deployment: DeploymentConfig = { asr: config.asr.enabled, integrations: config.integrations.enabled, embeddings: config.embeddings.enabled }
  const plan: PlanFlags = { integrations: getWorkspacePlan(workspace.subscription?.planCode || "starter").integrations }
  const enabledModules = resolveModules(industry, overrides, deployment, plan)
  const enabled = new Set(enabledModules.map((module) => module.key))
  return {
    industry,
    enabled,
    has: (key: string) => enabled.has(key),
    pushableTemplateCodes: enabledModules.flatMap((module) => module.pushableTemplateCodes ?? []),
  }
})

export class ModuleNotEnabledError extends Error {
  constructor(readonly moduleKey: string) {
    super(`module_not_enabled: ${moduleKey}`)
    this.name = "ModuleNotEnabledError"
  }
}

/** Throws unless the module is enabled for this workspace. The module-based successor to the old
 * lib/industry.ts's assertMode (deleted — every ad-hoc `workspace.industry !== "finance"` /
 * `!== "healthcare"` check across the app is now `requireModule`/`getWorkspaceCapabilities(...).has`
 * instead, one specific module per call site). */
export async function requireModule(workspaceId: string, key: string): Promise<void> {
  const caps = await getWorkspaceCapabilities(workspaceId)
  if (!caps.has(key)) throw new ModuleNotEnabledError(key)
}

export { MODULES }
