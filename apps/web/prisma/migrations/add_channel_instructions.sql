-- Add Channel table for storing per-channel instructions
CREATE TABLE IF NOT EXISTS "channels" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "systemPrompt" TEXT,
  "ekybotRules" TEXT,
  "useDefaultRules" BOOLEAN NOT NULL DEFAULT true,
  "instructionsSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on userId + key
CREATE UNIQUE INDEX IF NOT EXISTS "channels_userId_key_key" ON "channels"("userId", "key");

-- Create index on userId for faster lookups
CREATE INDEX IF NOT EXISTS "channels_userId_idx" ON "channels"("userId");
