-- Customers Module: tags, preferences, staff notes & saved views

-- Customer enrichment columns
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferencesJson" JSONB;

-- Staff-authored notes (rendered in the customer timeline)
CREATE TABLE IF NOT EXISTS "customer_notes" (
  "id"           TEXT NOT NULL,
  "businessId"   TEXT NOT NULL,
  "customerId"   TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorName"   TEXT,
  "body"         TEXT NOT NULL,
  "pinned"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customer_notes_businessId_customerId_idx"           ON "customer_notes"("businessId", "customerId");
CREATE INDEX IF NOT EXISTS "customer_notes_businessId_customerId_createdAt_idx" ON "customer_notes"("businessId", "customerId", "createdAt");

-- Reusable customer-list filter presets (per user)
CREATE TABLE IF NOT EXISTS "saved_views" (
  "id"          TEXT NOT NULL,
  "businessId"  TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "filtersJson" JSONB NOT NULL,
  "isShared"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "saved_views_businessId_userId_idx" ON "saved_views"("businessId", "userId");
