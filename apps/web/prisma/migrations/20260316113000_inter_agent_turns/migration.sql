CREATE TABLE "inter_agent_turns" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT,
  "conversationId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "relayId" TEXT NOT NULL,
  "sourceChannelKey" TEXT NOT NULL,
  "hostAgentId" TEXT NOT NULL,
  "targetAgentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'queued',
  "publishStep" TEXT,
  "systemAckMessageId" TEXT,
  "targetReplyMessageId" TEXT,
  "hostSummaryMessageId" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "queuedAt" TIMESTAMP(3),
  "sentToConnectorAt" TIMESTAMP(3),
  "targetReplyAt" TIMESTAMP(3),
  "hostSummaryAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "timeoutAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inter_agent_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inter_agent_turns_notificationId_key"
  ON "inter_agent_turns"("notificationId");

CREATE UNIQUE INDEX "inter_agent_turns_relayId_key"
  ON "inter_agent_turns"("relayId");

CREATE UNIQUE INDEX "inter_agent_turns_idempotencyKey_key"
  ON "inter_agent_turns"("idempotencyKey");

CREATE INDEX "inter_agent_turns_sourceChannelKey_idx"
  ON "inter_agent_turns"("sourceChannelKey");

CREATE INDEX "inter_agent_turns_hostAgentId_idx"
  ON "inter_agent_turns"("hostAgentId");

CREATE INDEX "inter_agent_turns_targetAgentId_idx"
  ON "inter_agent_turns"("targetAgentId");

CREATE INDEX "inter_agent_turns_state_idx"
  ON "inter_agent_turns"("state");

CREATE INDEX "inter_agent_turns_mentionId_idx"
  ON "inter_agent_turns"("mentionId");

CREATE INDEX "inter_agent_turns_conversationId_idx"
  ON "inter_agent_turns"("conversationId");

CREATE INDEX "inter_agent_turns_createdAt_idx"
  ON "inter_agent_turns"("createdAt");

ALTER TABLE "inter_agent_turns"
  ADD CONSTRAINT "inter_agent_turns_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "agent_notifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
