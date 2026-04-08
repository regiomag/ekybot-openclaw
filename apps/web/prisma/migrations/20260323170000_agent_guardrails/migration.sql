ALTER TABLE "agents"
ADD COLUMN "dailyBudget" DOUBLE PRECISION,
ADD COLUMN "disabledReason" TEXT,
ADD COLUMN "disabledAt" TIMESTAMP(3),
ADD COLUMN "lastStopNotifiedAt" TIMESTAMP(3);
