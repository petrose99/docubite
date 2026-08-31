-- Fixes two review findings on the Bigcapital provisioning queue (20260831020000):
-- 1. owner_user_id pins the provisioning attempt to whoever triggered it (enqueue or repair), so a
--    later backoff retry can't drift onto a different user's identity after an ownership transfer.
-- 2. external_ref persists the in-flight Bigcapital organization-build job id across retries, so a
--    "still building" timeout resumes polling the same build instead of starting a second one.

ALTER TABLE "integration_provision_jobs" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "integration_provision_jobs" ADD COLUMN "external_ref" TEXT;

ALTER TABLE "integration_provision_jobs" ADD CONSTRAINT "integration_provision_jobs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
