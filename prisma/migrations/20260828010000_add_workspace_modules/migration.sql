-- Industry workspaces + modules, Part 2 (Migration B): the WorkspaceModule table lib/modules
-- reads overrides from. Only deviations from a module's industry-default state get a row here —
-- "always"-tier core modules and un-toggled "default"-tier modules never need one.
--
-- Workspace-scoped exactly like integration_connections/integration_pushes
-- (20260826010000_add_integration_push): carries workspace_id and gets the same inert RLS policy,
-- added to WORKSPACE_SCOPED_MODELS in lib/workspace-scope.ts.
--
-- REMINDER for whoever flips RLS on for real: this table's policy is created here but the table is
-- not added to any "ENABLE ROW LEVEL SECURITY" rollout list yet — see risk #2 in
-- HANDOFF-INDUSTRY-WORKSPACES.md.

CREATE TABLE "workspace_modules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "requested_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_modules_workspace_id_module_key_key" ON "workspace_modules"("workspace_id", "module_key");

ALTER TABLE "workspace_modules" ADD CONSTRAINT "workspace_modules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_modules" ADD CONSTRAINT "workspace_modules_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-level security policy, inert until RLS is ENABLEd on this table (not done here — see the
-- reminder above). Mirrors 20260826010000 exactly.
DO $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'workspace_modules_workspace_isolation', 'workspace_modules');
  EXECUTE format(
    'CREATE POLICY %I ON %I USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace())',
    'workspace_modules_workspace_isolation', 'workspace_modules'
  );
END $$;
