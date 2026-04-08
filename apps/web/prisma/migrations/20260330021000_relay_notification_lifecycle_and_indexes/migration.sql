ALTER TABLE "agent_notifications"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "agent_notifications_status_attempts_idx"
ON "agent_notifications"("status", "attempts");

CREATE INDEX IF NOT EXISTS "agent_notifications_status_expiresAt_idx"
ON "agent_notifications"("status", "expiresAt");

DROP INDEX IF EXISTS "companion_machine_inventories_machineId_scannedAt_idx";

CREATE INDEX IF NOT EXISTS "companion_machine_inventories_machineId_scannedAt_idx"
ON "companion_machine_inventories"("machineId", "scannedAt" DESC);
