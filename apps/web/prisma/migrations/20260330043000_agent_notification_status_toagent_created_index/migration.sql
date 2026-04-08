CREATE INDEX IF NOT EXISTS "agent_notifications_status_toAgentId_createdAt_idx"
ON "agent_notifications"("status", "toAgentId", "createdAt");
