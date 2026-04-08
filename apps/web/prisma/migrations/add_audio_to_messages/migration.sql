-- Add audio field to messages for TTS and voice messages
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "audio" TEXT;
