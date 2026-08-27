-- WP4: one TaxProfile per workspace, versioned the same way DocumentTemplate is — currentVersion
-- plus immutable TaxProfileVersion rows, so a rate change never rewrites what an already-extracted
-- document was checked against (WP12).
CREATE TABLE "tax_profiles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "region" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_profile_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_profiles_workspace_id_key" ON "tax_profiles"("workspace_id");
CREATE UNIQUE INDEX "tax_profile_versions_profile_id_version_key" ON "tax_profile_versions"("profile_id", "version");

ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tax_profile_versions" ADD CONSTRAINT "tax_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "tax_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security policy for the workspace-scoped parent, inert until RLS is ENABLEd — see
-- 20260819190000_add_row_level_security. tax_profile_versions is reached only through its scoped
-- parent (the DocumentTemplateVersion precedent), so it gets no policy of its own.
DROP POLICY IF EXISTS "tax_profiles_workspace_isolation" ON "tax_profiles";
CREATE POLICY "tax_profiles_workspace_isolation" ON "tax_profiles" USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
