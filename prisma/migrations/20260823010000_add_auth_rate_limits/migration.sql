-- F14 backstop: see prisma/schema.prisma's AuthRateLimit doc comment and lib/rate-limit.ts.

CREATE TABLE "auth_rate_limits" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "auth_rate_limits_key_window_start_key" ON "auth_rate_limits"("key", "window_start");
CREATE INDEX "auth_rate_limits_window_start_idx" ON "auth_rate_limits"("window_start");
