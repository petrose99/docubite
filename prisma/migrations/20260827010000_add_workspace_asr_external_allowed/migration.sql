-- WP3: "BAA coverage confirmed" for a workspace's external ASR provider. False by default for
-- every workspace, including existing hipaaMode ones — a signed BAA is a fact about the world an
-- admin has to confirm, not something a migration can infer from prior dictation usage.
ALTER TABLE "workspaces" ADD COLUMN "asr_external_allowed" BOOLEAN NOT NULL DEFAULT false;
