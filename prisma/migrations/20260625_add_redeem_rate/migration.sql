-- AddColumn redeemRate and minRedeemPoints to Business
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "redeemRate" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "minRedeemPoints" INTEGER NOT NULL DEFAULT 100;
