-- Add index on Message.sessionId for faster queries
-- Run this in Supabase SQL Editor

CREATE INDEX IF NOT EXISTS "Message_sessionId_idx" ON "Message" ("sessionId");

-- Also add index on createdAt for ordering
CREATE INDEX IF NOT EXISTS "Message_sessionId_createdAt_idx" ON "Message" ("sessionId", "createdAt" DESC);

-- Check if indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'Message';
