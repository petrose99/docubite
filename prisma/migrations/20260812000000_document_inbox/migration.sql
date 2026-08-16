-- Fresh production baseline for Document Inbox.
-- Deploy only to an empty PostgreSQL database. No TaxHacker accounting data is
-- migrated by this application.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL, "avatar" TEXT, "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "workspaces" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "name" TEXT NOT NULL,
  "inbox_token" TEXT NOT NULL UNIQUE, "inbox_address" TEXT NOT NULL UNIQUE,
  "ai_enabled" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "workspace_members" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "role" TEXT NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("workspace_id", "user_id")
);
CREATE TABLE "workspace_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'member', "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL, "accepted_at" TIMESTAMP(3), "sent_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "workspace_subscriptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_code" TEXT NOT NULL DEFAULT 'starter', "status" TEXT NOT NULL DEFAULT 'trialing', "stripe_customer_id" TEXT UNIQUE,
  "stripe_subscription_id" TEXT UNIQUE, "current_period_start" TIMESTAMP(3), "current_period_end" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "workspace_usage_periods" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_start" TIMESTAMP(3) NOT NULL, "period_end" TIMESTAMP(3) NOT NULL, "inbound_document_count" INTEGER NOT NULL DEFAULT 0,
  "ai_extraction_count" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, UNIQUE("workspace_id", "period_start")
);
CREATE TABLE "document_templates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL, "name" TEXT NOT NULL, "document_type" TEXT NOT NULL, "is_system" BOOLEAN NOT NULL DEFAULT false,
  "current_version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, UNIQUE("workspace_id", "code")
);
CREATE TABLE "document_template_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "template_id" UUID NOT NULL REFERENCES "document_templates"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL, "fields" JSONB NOT NULL, "prompt" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("template_id", "version")
);
CREATE TABLE "documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "template_id" UUID REFERENCES "document_templates"("id") ON DELETE SET NULL, "template_version_id" UUID REFERENCES "document_template_versions"("id") ON DELETE SET NULL,
  "source" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'received', "filename" TEXT NOT NULL, "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL, "sha256" TEXT NOT NULL, "storage_key" TEXT, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_expires_at" TIMESTAMP(3) NOT NULL, "source_deleted_at" TIMESTAMP(3), "sender_hash" TEXT, "field_snapshot" JSONB NOT NULL,
  "raw_extraction" JSONB, "reviewed_data" JSONB, "confidence" JSONB, "ai_quota_claimed" BOOLEAN NOT NULL DEFAULT false, "search_text" TEXT NOT NULL DEFAULT '', "error_code" TEXT,
  "reviewed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE("workspace_id", "sha256")
);
CREATE TABLE "inbound_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "message_id_hash" TEXT NOT NULL, "receipt_id" TEXT UNIQUE, "raw_storage_key" TEXT, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_expires_at" TIMESTAMP(3) NOT NULL, "source_deleted_at" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'received', "processed_at" TIMESTAMP(3),
  UNIQUE("workspace_id", "message_id_hash")
);
CREATE TABLE "document_processing_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" UUID REFERENCES "documents"("id") ON DELETE CASCADE, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0, "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lease_until" TIMESTAMP(3),
  "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "error_code" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "document_audit_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" UUID REFERENCES "documents"("id") ON DELETE CASCADE, "actor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "stripe_webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "stripe_event_id" TEXT NOT NULL UNIQUE, "workspace_id" UUID REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0, "error_code" TEXT,
  "processing_started_at" TIMESTAMP(3), "lease_until" TIMESTAMP(3), "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "token" TEXT NOT NULL UNIQUE, "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "ip_address" TEXT, "user_agent" TEXT,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY, "account_id" TEXT NOT NULL, "provider_id" TEXT NOT NULL, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" TEXT, "refresh_token" TEXT, "id_token" TEXT, "access_token_expires_at" TIMESTAMP(3), "refresh_token_expires_at" TIMESTAMP(3),
  "scope" TEXT, "password" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "verification" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "identifier" TEXT NOT NULL, "value" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");
CREATE INDEX "documents_workspace_status_idx" ON "documents"("workspace_id", "status");
CREATE INDEX "documents_workspace_received_idx" ON "documents"("workspace_id", "received_at");
CREATE INDEX "documents_source_expiry_idx" ON "documents"("source_expires_at");
CREATE INDEX "inbound_messages_source_expiry_idx" ON "inbound_messages"("source_expires_at");
CREATE INDEX "document_jobs_status_scheduled_idx" ON "document_processing_jobs"("status", "scheduled_at");
CREATE INDEX "document_audit_workspace_created_idx" ON "document_audit_events"("workspace_id", "created_at");
CREATE INDEX "stripe_webhook_events_workspace_id_idx" ON "stripe_webhook_events"("workspace_id");
CREATE INDEX "stripe_webhook_events_status_lease_until_idx" ON "stripe_webhook_events"("status", "lease_until");
