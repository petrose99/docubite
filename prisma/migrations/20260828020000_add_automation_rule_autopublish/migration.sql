-- Part 5b: a supplier rule can opt a document it codes into an automatic push to the workspace's
-- connected accounting provider, instead of waiting for someone to press Push by hand. Off by
-- default on every existing rule.
ALTER TABLE "automation_rules" ADD COLUMN "autopublish" BOOLEAN NOT NULL DEFAULT false;
