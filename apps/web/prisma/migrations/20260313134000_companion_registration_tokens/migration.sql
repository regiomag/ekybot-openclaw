-- CreateTable
CREATE TABLE "companion_registration_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companion_registration_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companion_registration_tokens_tokenHash_key"
ON "companion_registration_tokens"("tokenHash");

CREATE INDEX "companion_registration_tokens_userId_idx"
ON "companion_registration_tokens"("userId");

CREATE INDEX "companion_registration_tokens_expiresAt_idx"
ON "companion_registration_tokens"("expiresAt");

CREATE INDEX "companion_registration_tokens_usedAt_idx"
ON "companion_registration_tokens"("usedAt");

ALTER TABLE "companion_registration_tokens"
ADD CONSTRAINT "companion_registration_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
