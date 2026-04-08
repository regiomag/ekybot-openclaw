CREATE INDEX IF NOT EXISTS "long_running_runs_userId_status_idx"
ON "long_running_runs"("userId", "status");

CREATE INDEX IF NOT EXISTS "long_running_runs_userId_updatedAt_idx"
ON "long_running_runs"("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "companion_machines_userId_status_idx"
ON "companion_machines"("userId", "status");
