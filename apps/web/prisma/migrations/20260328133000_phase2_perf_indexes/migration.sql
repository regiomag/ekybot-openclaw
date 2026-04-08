CREATE INDEX IF NOT EXISTS "messages_sessionId_createdAt_idx"
ON "messages"("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "long_running_runs_agentId_status_idx"
ON "long_running_runs"("agentId", "status");
