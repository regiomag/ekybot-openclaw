ALTER TABLE "gateway_configs"
ADD COLUMN "cronDefaultModel" TEXT NOT NULL DEFAULT 'ollama/nemotron-3-nano:30b',
ADD COLUMN "cronContextLimitTokens" INTEGER NOT NULL DEFAULT 32000;
