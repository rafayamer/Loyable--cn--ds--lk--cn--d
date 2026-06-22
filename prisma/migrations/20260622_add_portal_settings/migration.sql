-- Add portalSettings JSON column to Business for customer portal content management
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "portalSettings" JSONB;
