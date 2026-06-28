-- Loyalty Engine: rewards catalogue, gift cards & gamification

-- Reward templates (point-priced catalogue)
CREATE TABLE IF NOT EXISTS "reward_templates" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "imageUrl" TEXT,
  "pointsCost" INTEGER NOT NULL,
  "value" DECIMAL(12,2),
  "freeItemName" TEXT,
  "minTierRank" INTEGER,
  "stock" INTEGER,
  "perCustomerLimit" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reward_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "reward_templates_businessId_isActive_idx" ON "reward_templates"("businessId","isActive");

CREATE TABLE IF NOT EXISTS "reward_redemptions" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "rewardTemplateId" TEXT NOT NULL,
  "pointsSpent" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "couponId" TEXT,
  "walletLedgerId" TEXT,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt" TIMESTAMP(3),
  "fulfilledByUserId" TEXT,
  CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "reward_redemptions_businessId_customerId_idx" ON "reward_redemptions"("businessId","customerId");
CREATE INDEX IF NOT EXISTS "reward_redemptions_businessId_rewardTemplateId_idx" ON "reward_redemptions"("businessId","rewardTemplateId");
CREATE INDEX IF NOT EXISTS "reward_redemptions_businessId_status_idx" ON "reward_redemptions"("businessId","status");

-- Gift cards (prepaid stored value)
CREATE TABLE IF NOT EXISTS "gift_cards" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "initialBalance" DECIMAL(12,2) NOT NULL,
  "currentBalance" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "purchaserName" TEXT,
  "recipientName" TEXT,
  "recipientPhone" TEXT,
  "message" TEXT,
  "redeemedByCustomerId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_code_key" ON "gift_cards"("code");
CREATE INDEX IF NOT EXISTS "gift_cards_businessId_status_idx" ON "gift_cards"("businessId","status");
CREATE INDEX IF NOT EXISTS "gift_cards_businessId_code_idx" ON "gift_cards"("businessId","code");

-- Gamification: challenges, progress, badges
CREATE TABLE IF NOT EXISTS "challenges" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "goal" INTEGER NOT NULL,
  "rewardPoints" INTEGER NOT NULL DEFAULT 0,
  "badgeName" TEXT,
  "badgeIcon" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "challenges_businessId_isActive_idx" ON "challenges"("businessId","isActive");

CREATE TABLE IF NOT EXISTS "challenge_progress" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "rewardedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "challenge_progress_customerId_challengeId_key" ON "challenge_progress"("customerId","challengeId");
CREATE INDEX IF NOT EXISTS "challenge_progress_businessId_customerId_idx" ON "challenge_progress"("businessId","customerId");
CREATE INDEX IF NOT EXISTS "challenge_progress_businessId_challengeId_idx" ON "challenge_progress"("businessId","challengeId");

CREATE TABLE IF NOT EXISTS "customer_badges" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "challengeId" TEXT,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_badges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_badges_customerId_name_key" ON "customer_badges"("customerId","name");
CREATE INDEX IF NOT EXISTS "customer_badges_businessId_customerId_idx" ON "customer_badges"("businessId","customerId");
