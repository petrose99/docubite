-- Dext-parity Phase 3 WP3.4: reminders. Both nullable — null means "no reminder sent yet".
ALTER TABLE "review_tasks" ADD COLUMN "last_reminder_at" TIMESTAMP(3);
ALTER TABLE "expense_claims" ADD COLUMN "last_reminder_at" TIMESTAMP(3);
