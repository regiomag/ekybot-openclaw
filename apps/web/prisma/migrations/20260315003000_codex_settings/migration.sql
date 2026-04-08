ALTER TABLE "gateway_configs"
  ADD COLUMN "codexEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "codexProjectChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
