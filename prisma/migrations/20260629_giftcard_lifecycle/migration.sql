-- Gift card lifecycle: assignment, menu-restriction, consent-gated deletion
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "issuedToCustomerId" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "allowedItems" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "gift_cards_businessId_issuedToCustomerId_idx" ON "gift_cards"("businessId","issuedToCustomerId");
