CREATE TABLE "inter_agent_run_events" (
  "id" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "publishStep" TEXT,
  "messageId" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inter_agent_run_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inter_agent_run_events_turnId_happenedAt_idx"
  ON "inter_agent_run_events"("turnId", "happenedAt");

CREATE INDEX "inter_agent_run_events_type_happenedAt_idx"
  ON "inter_agent_run_events"("type", "happenedAt");

CREATE INDEX "inter_agent_run_events_state_happenedAt_idx"
  ON "inter_agent_run_events"("state", "happenedAt");

ALTER TABLE "inter_agent_run_events"
  ADD CONSTRAINT "inter_agent_run_events_turnId_fkey"
  FOREIGN KEY ("turnId") REFERENCES "inter_agent_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
