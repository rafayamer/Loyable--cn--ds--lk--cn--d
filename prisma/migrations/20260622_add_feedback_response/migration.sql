-- NPS / post-visit feedback collection
CREATE TABLE IF NOT EXISTS "feedback_responses" (
  "id"          TEXT NOT NULL,
  "businessId"  TEXT NOT NULL,
  "customerId"  TEXT NOT NULL,
  "visitId"     TEXT,
  "score"       INTEGER NOT NULL,
  "comment"     TEXT,
  "channel"     TEXT NOT NULL DEFAULT 'WHATSAPP',
  "sentAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "feedback_responses_businessId_createdAt_idx" ON "feedback_responses"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "feedback_responses_customerId_idx"            ON "feedback_responses"("customerId");
CREATE INDEX IF NOT EXISTS "feedback_responses_businessId_score_idx"      ON "feedback_responses"("businessId", "score");
