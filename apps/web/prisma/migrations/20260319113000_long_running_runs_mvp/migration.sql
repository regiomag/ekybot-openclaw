CREATE TYPE "LongRunningRunStatus" AS ENUM (
  'created',
  'accepted',
  'working',
  'delayed',
  'stalled',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "LongRunningRunPhase" AS ENUM (
  'intake',
  'analysis',
  'execution',
  'writing',
  'publishing',
  'done',
  'error'
);

CREATE TABLE "long_running_runs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelKey" TEXT NOT NULL,
  "sessionId" TEXT,
  "agentId" TEXT,
  "userMessageId" TEXT,
  "requestId" TEXT,
  "status" "LongRunningRunStatus" NOT NULL DEFAULT 'created',
  "phase" "LongRunningRunPhase" NOT NULL DEFAULT 'intake',
  "title" TEXT,
  "progressHint" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastRenderedAt" TIMESTAMP(3),
  "finalMessageId" TEXT,
  "metadata" JSONB,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "long_running_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "long_running_runs_requestId_key"
  ON "long_running_runs"("requestId");

CREATE INDEX "long_running_runs_userId_idx"
  ON "long_running_runs"("userId");

CREATE INDEX "long_running_runs_userId_channelKey_idx"
  ON "long_running_runs"("userId", "channelKey");

CREATE INDEX "long_running_runs_status_idx"
  ON "long_running_runs"("status");

CREATE INDEX "long_running_runs_createdAt_idx"
  ON "long_running_runs"("createdAt");

ALTER TABLE "long_running_runs"
  ADD CONSTRAINT "long_running_runs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
