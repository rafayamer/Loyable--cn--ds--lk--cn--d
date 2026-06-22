-- Revenue attribution: track which campaign/automation drove each visit
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "attributedCampaignId"   TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "attributedAutomationId" TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "attributionWindowHours" INTEGER DEFAULT 48;

CREATE INDEX IF NOT EXISTS "visits_attributedCampaignId_idx"   ON "visits"("attributedCampaignId")   WHERE "attributedCampaignId"   IS NOT NULL;
CREATE INDEX IF NOT EXISTS "visits_attributedAutomationId_idx" ON "visits"("attributedAutomationId") WHERE "attributedAutomationId" IS NOT NULL;
