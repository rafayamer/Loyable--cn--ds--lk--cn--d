import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { prisma } from './config/prisma';
import { initRedis } from './config/redis';
import { initRedis as initTenantRedis } from './middleware/tenant-scope-middleware';
import { wahaWebhookRouter } from './services/messaging-gateway';
import { bootBaileySessions } from './services/baileys-service';

// ── Crash visibility ──────────────────────────────────────────────
// Print the moment the process starts so we always see *something* in
// the platform logs, and never let an async crash die silently.
console.log('[app] Process starting. NODE_ENV=' + (process.env.NODE_ENV ?? 'undefined'));
// Throttle noisy, expected transient rejections (chiefly Redis: Upstash
// over-limit or a socket drop) so a degraded dependency can't flood the logs
// or trip Railway's log rate limit. Other rejections are always logged.
let _lastRedisRejectionLog = 0;
process.on('unhandledRejection', (reason) => {
  const msg = (reason as Error)?.message ?? String(reason);
  const isRedis = /max requests limit exceeded|max daily request limit|Socket closed unexpectedly|Connection is closed|ECONNRESET|ETIMEDOUT/i.test(msg);
  if (isRedis) {
    const now = Date.now();
    if (now - _lastRedisRejectionLog > 60_000) {
      _lastRedisRejectionLog = now;
      console.error('[app] UNHANDLED REJECTION (Redis, throttled):', msg);
    }
    return;
  }
  console.error('[app] UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[app] UNCAUGHT EXCEPTION:', err);
});

const app = express();

/**
 * Self-healing schema patches for purely ADDITIVE changes.
 * Runs at startup with the app's own DB credentials so additive columns/indexes
 * are present even if `prisma db push` hasn't been run yet. Every statement is
 * idempotent (IF NOT EXISTS) and safe to run on every boot.
 */
async function ensureSchemaPatches() {
  const stmts: Array<{ label: string; sql: string }> = [
    { label: 'customers.isStaff',
      sql: 'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isStaff" BOOLEAN NOT NULL DEFAULT false' },
    { label: 'businesses.bigSpenderThreshold',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "bigSpenderThreshold" INTEGER NOT NULL DEFAULT 500' },
    // Idempotency guard against points double-credit. Uses a partial-safe unique
    // index; if legacy duplicate rows exist this will warn but never crash boot.
    { label: 'reward_points_ledger uniq(customerId,reason,referenceId)',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "reward_points_ledger_customerId_reason_referenceId_key" ON "reward_points_ledger" ("customerId", "reason", "referenceId")' },
    // WhatsApp warmup + failover columns (additive, idempotent — present even
    // before `prisma db push` runs so the reliability layer can read/write them).
    { label: 'businesses.wahaConnectedAt',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wahaConnectedAt" TIMESTAMP(3)' },
    { label: 'businesses.wahaBackupSessionId',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wahaBackupSessionId" TEXT' },
    { label: 'businesses.wahaActiveSlot',
      sql: `ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wahaActiveSlot" TEXT NOT NULL DEFAULT 'PRIMARY'` },
    { label: 'businesses.wahaLastHealthyAt',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wahaLastHealthyAt" TIMESTAMP(3)' },
    { label: 'businesses.wahaHealthFailCount',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wahaHealthFailCount" INTEGER NOT NULL DEFAULT 0' },
    { label: 'businesses.warmupEnabled',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "warmupEnabled" BOOLEAN NOT NULL DEFAULT true' },
    { label: 'businesses.dailyMessageCapOverride',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "dailyMessageCapOverride" INTEGER' },
    { label: 'customers.marketingConsentWhatsapp default true',
      sql: 'UPDATE "customers" SET "marketingConsentWhatsapp" = true WHERE "marketingConsentWhatsapp" = false AND "isSuppressed" = false' },
    { label: 'whatsapp_messages table',
      sql: `CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "chatId" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "body" TEXT NOT NULL DEFAULT '',
        "fromMe" BOOLEAN NOT NULL DEFAULT false,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "msgId" TEXT,
        "mediaType" TEXT,
        "customerId" TEXT,
        CONSTRAINT "whatsapp_messages_businessId_msgId_key" UNIQUE ("businessId","msgId")
      )` },
    { label: 'whatsapp_messages idx chatId',
      sql: 'CREATE INDEX IF NOT EXISTS "wam_biz_chat_ts" ON "whatsapp_messages" ("businessId","chatId","timestamp")' },
    { label: 'whatsapp_messages idx ts',
      sql: 'CREATE INDEX IF NOT EXISTS "wam_biz_ts" ON "whatsapp_messages" ("businessId","timestamp")' },
    // Clear stale WAHA URLs so the WAHA_BASE_URL env var takes effect. This
    // covers localhost (saved before the env var existed) and any persisted
    // value that no longer matches the configured env var (e.g. an old/dead
    // Railway public domain from a previous WAHA service).
    { label: 'businesses.wahaBaseUrl clear localhost',
      sql: `UPDATE "businesses" SET "wahaBaseUrl" = NULL WHERE "wahaBaseUrl" LIKE '%localhost%'` },
    // ── Customers Module: tags, preferences, notes & saved views ──
    { label: 'customers.tags',
      sql: `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}'` },
    { label: 'customers.preferencesJson',
      sql: 'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferencesJson" JSONB' },
    { label: 'customer_notes table',
      sql: `CREATE TABLE IF NOT EXISTS "customer_notes" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "authorUserId" TEXT,
        "authorName" TEXT,
        "body" TEXT NOT NULL,
        "pinned" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'customer_notes idx customer',
      sql: 'CREATE INDEX IF NOT EXISTS "customer_notes_businessId_customerId_idx" ON "customer_notes" ("businessId","customerId")' },
    { label: 'customer_notes idx customer createdAt',
      sql: 'CREATE INDEX IF NOT EXISTS "customer_notes_businessId_customerId_createdAt_idx" ON "customer_notes" ("businessId","customerId","createdAt")' },
    { label: 'saved_views table',
      sql: `CREATE TABLE IF NOT EXISTS "saved_views" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "filtersJson" JSONB NOT NULL,
        "isShared" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'saved_views idx user',
      sql: 'CREATE INDEX IF NOT EXISTS "saved_views_businessId_userId_idx" ON "saved_views" ("businessId","userId")' },
    // ── Loyalty Engine: rewards, gift cards & gamification ──
    { label: 'reward_templates table',
      sql: `CREATE TABLE IF NOT EXISTS "reward_templates" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL,
        "name" TEXT NOT NULL, "description" TEXT, "type" TEXT NOT NULL, "imageUrl" TEXT,
        "pointsCost" INTEGER NOT NULL, "value" DECIMAL(12,2), "freeItemName" TEXT,
        "minTierRank" INTEGER, "stock" INTEGER, "perCustomerLimit" INTEGER,
        "isActive" BOOLEAN NOT NULL DEFAULT true, "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'reward_templates idx',
      sql: 'CREATE INDEX IF NOT EXISTS "reward_templates_businessId_isActive_idx" ON "reward_templates" ("businessId","isActive")' },
    { label: 'reward_redemptions table',
      sql: `CREATE TABLE IF NOT EXISTS "reward_redemptions" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
        "rewardTemplateId" TEXT NOT NULL, "pointsSpent" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING', "couponId" TEXT, "walletLedgerId" TEXT,
        "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fulfilledAt" TIMESTAMP(3), "fulfilledByUserId" TEXT
      )` },
    { label: 'reward_redemptions idx customer',
      sql: 'CREATE INDEX IF NOT EXISTS "reward_redemptions_businessId_customerId_idx" ON "reward_redemptions" ("businessId","customerId")' },
    { label: 'reward_redemptions idx status',
      sql: 'CREATE INDEX IF NOT EXISTS "reward_redemptions_businessId_status_idx" ON "reward_redemptions" ("businessId","status")' },
    { label: 'gift_cards table',
      sql: `CREATE TABLE IF NOT EXISTS "gift_cards" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL,
        "code" TEXT NOT NULL, "initialBalance" DECIMAL(12,2) NOT NULL, "currentBalance" DECIMAL(12,2) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE', "purchaserName" TEXT, "recipientName" TEXT,
        "recipientPhone" TEXT, "message" TEXT, "redeemedByCustomerId" TEXT, "expiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'gift_cards uniq code',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_code_key" ON "gift_cards" ("code")' },
    { label: 'gift_cards.issuedToCustomerId',
      sql: 'ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "issuedToCustomerId" TEXT' },
    { label: 'gift_cards.allowedItems',
      sql: `ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "allowedItems" TEXT[] NOT NULL DEFAULT '{}'` },
    { label: 'gift_cards.deletionReason',
      sql: 'ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "deletionReason" TEXT' },
    { label: 'gift_cards.deletionRequestedAt',
      sql: 'ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3)' },
    { label: 'gift_cards idx issuedTo',
      sql: 'CREATE INDEX IF NOT EXISTS "gift_cards_businessId_issuedToCustomerId_idx" ON "gift_cards" ("businessId","issuedToCustomerId")' },
    { label: 'gift_cards idx status',
      sql: 'CREATE INDEX IF NOT EXISTS "gift_cards_businessId_status_idx" ON "gift_cards" ("businessId","status")' },
    { label: 'challenges table',
      sql: `CREATE TABLE IF NOT EXISTS "challenges" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL,
        "name" TEXT NOT NULL, "description" TEXT, "type" TEXT NOT NULL, "goal" INTEGER NOT NULL,
        "rewardPoints" INTEGER NOT NULL DEFAULT 0, "badgeName" TEXT, "badgeIcon" TEXT,
        "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'challenges idx',
      sql: 'CREATE INDEX IF NOT EXISTS "challenges_businessId_isActive_idx" ON "challenges" ("businessId","isActive")' },
    { label: 'challenge_progress table',
      sql: `CREATE TABLE IF NOT EXISTS "challenge_progress" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
        "challengeId" TEXT NOT NULL, "progress" INTEGER NOT NULL DEFAULT 0,
        "completed" BOOLEAN NOT NULL DEFAULT false, "completedAt" TIMESTAMP(3), "rewardedAt" TIMESTAMP(3),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'challenge_progress uniq',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "challenge_progress_customerId_challengeId_key" ON "challenge_progress" ("customerId","challengeId")' },
    { label: 'challenge_progress idx customer',
      sql: 'CREATE INDEX IF NOT EXISTS "challenge_progress_businessId_customerId_idx" ON "challenge_progress" ("businessId","customerId")' },
    { label: 'customer_badges table',
      sql: `CREATE TABLE IF NOT EXISTS "customer_badges" (
        "id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
        "challengeId" TEXT, "name" TEXT NOT NULL, "icon" TEXT,
        "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'customer_badges uniq',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "customer_badges_customerId_name_key" ON "customer_badges" ("customerId","name")' },
    { label: 'customer_badges idx customer',
      sql: 'CREATE INDEX IF NOT EXISTS "customer_badges_businessId_customerId_idx" ON "customer_badges" ("businessId","customerId")' },
    // ── A/B Campaign Testing ──
    { label: 'campaigns.abVariants',
      sql: 'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "abVariants" JSONB' },
    { label: 'campaigns.abWinnerId',
      sql: 'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "abWinnerId" TEXT' },
    { label: 'campaigns.abTestStartedAt',
      sql: 'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "abTestStartedAt" TIMESTAMP(3)' },
    { label: 'message_queue.abVariantId',
      sql: 'ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "abVariantId" TEXT' },
    // ── Churn Risk Score (ML-lite nightly scoring) ──
    { label: 'customers.churnRiskScore',
      sql: 'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "churnRiskScore" INTEGER NOT NULL DEFAULT 0' },
    { label: 'customers.churnRiskScoredAt',
      sql: 'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "churnRiskScoredAt" TIMESTAMP(3)' },
    // ── Opt-out reason stored in ConsentChangeLog (keyword field already exists) ──
    // NOTE: the Prisma model ConsentChangeLog maps to "consent_change_logs" (plural);
    // the previous singular "consent_change_log" caused
    // `relation "consent_change_log" does not exist` on every boot.
    { label: 'consent_change_logs.optOutReason',
      sql: 'ALTER TABLE "consent_change_logs" ADD COLUMN IF NOT EXISTS "optOutReason" TEXT' },
    // ── Per-tenant timezone support ──
    { label: 'businesses.timezone',
      sql: `ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC'` },
    // ── TOTP 2FA ──
    { label: 'users.totpSecret',
      sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT' },
    { label: 'users.totpEnabled',
      sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false' },
    // ── Integration Marketplace ──
    { label: 'integration_configs table',
      sql: `CREATE TABLE IF NOT EXISTS "integration_configs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "isEnabled" BOOLEAN NOT NULL DEFAULT false,
        "configJson" JSONB NOT NULL DEFAULT '{}',
        "lastSyncAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "integration_configs_businessId_provider_key" UNIQUE ("businessId","provider")
      )` },
    { label: 'integration_configs idx biz',
      sql: 'CREATE INDEX IF NOT EXISTS "ic_biz_provider" ON "integration_configs" ("businessId","provider")' },
    // ── Custom Segment Builder ──
    { label: 'custom_segments table',
      sql: `CREATE TABLE IF NOT EXISTS "custom_segments" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "rulesJson" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'custom_segments idx biz',
      sql: 'CREATE INDEX IF NOT EXISTS "cs_biz_updated" ON "custom_segments" ("businessId","updatedAt")' },
    // ── Campaign Approval Workflow ──
    { label: 'businesses.requiresCampaignApproval',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "requiresCampaignApproval" BOOLEAN NOT NULL DEFAULT false' },
    { label: 'campaigns.approvedAt',
      sql: 'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)' },
    { label: 'campaigns.rejectionReason',
      sql: 'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT' },
    // ── NPS / Feedback system ──
    { label: 'feedback_responses table',
      sql: `CREATE TABLE IF NOT EXISTS "feedback_responses" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "visitId" TEXT,
        "score" INTEGER NOT NULL,
        "comment" TEXT,
        "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
        "sentAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'feedback_responses idx biz',
      sql: 'CREATE INDEX IF NOT EXISTS "fr_biz_created" ON "feedback_responses" ("businessId","createdAt")' },
    { label: 'feedback_responses idx customer',
      sql: 'CREATE INDEX IF NOT EXISTS "fr_customer" ON "feedback_responses" ("customerId")' },
    { label: 'feedback_responses idx score',
      sql: 'CREATE INDEX IF NOT EXISTS "fr_biz_score" ON "feedback_responses" ("businessId","score")' },
    { label: 'cohort_retention_snapshots table',
      sql: `CREATE TABLE IF NOT EXISTS "cohort_retention_snapshots" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "cohortMonth" TEXT NOT NULL,
        "cohortSize" INTEGER NOT NULL DEFAULT 0,
        "retentionByOffset" JSONB NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("businessId", "cohortMonth")
      )` },
    { label: 'cohort_retention_snapshots idx',
      sql: 'CREATE INDEX IF NOT EXISTS "crs_biz_month" ON "cohort_retention_snapshots" ("businessId","cohortMonth")' },
    // ── Lemon Squeezy billing columns + webhook idempotency ──
    { label: 'subscriptions.lsCustomerId',     sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lsCustomerId" TEXT' },
    { label: 'subscriptions.lsOrderId',        sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lsOrderId" TEXT' },
    { label: 'subscriptions.lsSubscriptionId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lsSubscriptionId" TEXT' },
    { label: 'subscriptions.lsProductId',      sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lsProductId" TEXT' },
    { label: 'subscriptions.lsVariantId',      sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lsVariantId" TEXT' },
    { label: 'subscriptions.planSlug',         sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planSlug" TEXT' },
    { label: 'subscriptions.renewsAt',         sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renewsAt" TIMESTAMP(3)' },
    { label: 'subscriptions.endsAt',           sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3)' },
    { label: 'subscriptions.cancelledAt',      sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3)' },
    { label: 'subscriptions.trialEndsAt',      sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3)' },
    { label: 'subscriptions.lastWebhookEventId',sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastWebhookEventId" TEXT' },
    { label: 'subscriptions.lastSyncedAt',     sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3)' },
    { label: 'processed_webhooks table',
      sql: `CREATE TABLE IF NOT EXISTS "processed_webhooks" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "provider" TEXT NOT NULL,
        "dedupeKey" TEXT NOT NULL,
        "eventName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "processed_webhooks_provider_dedupeKey_key" UNIQUE ("provider","dedupeKey")
      )` },
    { label: 'processed_webhooks idx',
      sql: 'CREATE INDEX IF NOT EXISTS "pwh_provider_created" ON "processed_webhooks" ("provider","createdAt")' },
    // ── AI · Business reports & run logs ──
    { label: 'business_reports table',
      sql: `CREATE TABLE IF NOT EXISTS "business_reports" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "periodStart" TIMESTAMP(3) NOT NULL,
        "periodEnd" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "subject" TEXT,
        "previewText" TEXT,
        "summary" TEXT,
        "keyMetricsJson" JSONB NOT NULL DEFAULT '{}',
        "recommendationsJson" JSONB NOT NULL DEFAULT '[]',
        "llmUsed" BOOLEAN NOT NULL DEFAULT false,
        "emailStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
        "emailError" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sentAt" TIMESTAMP(3),
        CONSTRAINT "business_reports_businessId_type_periodStart_key" UNIQUE ("businessId","type","periodStart")
      )` },
    { label: 'business_reports idx',
      sql: 'CREATE INDEX IF NOT EXISTS "br_biz_type_period" ON "business_reports" ("businessId","type","periodStart")' },
    { label: 'ai_run_logs table',
      sql: `CREATE TABLE IF NOT EXISTS "ai_run_logs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "taskType" TEXT NOT NULL,
        "inputSummary" TEXT,
        "outputSummary" TEXT,
        "model" TEXT,
        "promptTokens" INTEGER NOT NULL DEFAULT 0,
        "completionTokens" INTEGER NOT NULL DEFAULT 0,
        "costEstimate" DECIMAL(12,6) NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'OK',
        "error" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'ai_run_logs idx created',
      sql: 'CREATE INDEX IF NOT EXISTS "airun_biz_created" ON "ai_run_logs" ("businessId","createdAt")' },
    { label: 'ai_run_logs idx task',
      sql: 'CREATE INDEX IF NOT EXISTS "airun_biz_task" ON "ai_run_logs" ("businessId","taskType")' },
    // ── Operations · HR & Staff ──
    { label: 'employees table',
      sql: `CREATE TABLE IF NOT EXISTS "employees" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "branchLocationId" TEXT,
        "userId" TEXT,
        "fullName" TEXT NOT NULL,
        "email" TEXT,
        "phone" TEXT,
        "jobTitle" TEXT,
        "hrRole" TEXT NOT NULL DEFAULT 'CASHIER',
        "customRoleId" TEXT,
        "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
        "status" TEXT NOT NULL DEFAULT 'ONBOARDING',
        "hireDate" TIMESTAMP(3),
        "dateOfBirth" TIMESTAMP(3),
        "address" TEXT,
        "avatarUrl" TEXT,
        "emergencyContactName" TEXT,
        "emergencyContactPhone" TEXT,
        "onboardingJson" JSONB NOT NULL DEFAULT '[]',
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'employees idx status',
      sql: 'CREATE INDEX IF NOT EXISTS "emp_biz_status" ON "employees" ("businessId","status")' },
    { label: 'employees idx branch',
      sql: 'CREATE INDEX IF NOT EXISTS "emp_biz_branch" ON "employees" ("businessId","branchLocationId")' },
    { label: 'employee_documents table',
      sql: `CREATE TABLE IF NOT EXISTS "employee_documents" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'OTHER',
        "name" TEXT NOT NULL,
        "issuer" TEXT,
        "fileUrl" TEXT,
        "issuedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'employee_documents idx',
      sql: 'CREATE INDEX IF NOT EXISTS "empdoc_biz_emp" ON "employee_documents" ("businessId","employeeId")' },
    { label: 'custom_roles table',
      sql: `CREATE TABLE IF NOT EXISTS "custom_roles" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "permissionsJson" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'custom_roles idx',
      sql: 'CREATE INDEX IF NOT EXISTS "crole_biz" ON "custom_roles" ("businessId")' },
    { label: 'training_modules table',
      sql: `CREATE TABLE IF NOT EXISTS "training_modules" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "type" TEXT NOT NULL DEFAULT 'VIDEO',
        "contentUrl" TEXT,
        "quizJson" JSONB,
        "passingScore" INTEGER NOT NULL DEFAULT 70,
        "isRequired" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'training_modules idx',
      sql: 'CREATE INDEX IF NOT EXISTS "tmod_biz_active" ON "training_modules" ("businessId","isActive")' },
    { label: 'training_progress table',
      sql: `CREATE TABLE IF NOT EXISTS "training_progress" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "moduleId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
        "score" INTEGER,
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "training_progress_employeeId_moduleId_key" UNIQUE ("employeeId","moduleId")
      )` },
    { label: 'training_progress idx',
      sql: 'CREATE INDEX IF NOT EXISTS "tprog_biz_emp" ON "training_progress" ("businessId","employeeId")' },
    { label: 'attendance_records table',
      sql: `CREATE TABLE IF NOT EXISTS "attendance_records" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "branchLocationId" TEXT,
        "clockIn" TIMESTAMP(3) NOT NULL,
        "clockOut" TIMESTAMP(3),
        "breakMinutes" INTEGER NOT NULL DEFAULT 0,
        "method" TEXT NOT NULL DEFAULT 'WEB',
        "latitude" DOUBLE PRECISION,
        "longitude" DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'attendance_records idx',
      sql: 'CREATE INDEX IF NOT EXISTS "att_biz_emp_in" ON "attendance_records" ("businessId","employeeId","clockIn")' },
    { label: 'shifts table',
      sql: `CREATE TABLE IF NOT EXISTS "shifts" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "branchLocationId" TEXT,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL,
        "role" TEXT,
        "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'shifts idx start',
      sql: 'CREATE INDEX IF NOT EXISTS "shift_biz_start" ON "shifts" ("businessId","startsAt")' },
    { label: 'shifts idx emp',
      sql: 'CREATE INDEX IF NOT EXISTS "shift_biz_emp" ON "shifts" ("businessId","employeeId")' },
    { label: 'leave_requests table',
      sql: `CREATE TABLE IF NOT EXISTS "leave_requests" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'ANNUAL',
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3) NOT NULL,
        "reason" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "approverId" TEXT,
        "decidedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'leave_requests idx status',
      sql: 'CREATE INDEX IF NOT EXISTS "leave_biz_status" ON "leave_requests" ("businessId","status")' },
    { label: 'leave_requests idx emp',
      sql: 'CREATE INDEX IF NOT EXISTS "leave_biz_emp" ON "leave_requests" ("businessId","employeeId")' },
    { label: 'employee_rewards table',
      sql: `CREATE TABLE IF NOT EXISTS "employee_rewards" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'POINTS',
        "points" INTEGER NOT NULL DEFAULT 0,
        "amount" DECIMAL(12,2),
        "note" TEXT,
        "status" TEXT NOT NULL DEFAULT 'APPROVED',
        "grantedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )` },
    { label: 'employee_rewards idx',
      sql: 'CREATE INDEX IF NOT EXISTS "emprew_biz_emp" ON "employee_rewards" ("businessId","employeeId")' },
    ...(process.env.WAHA_BASE_URL && process.env.WAHA_BASE_URL.trim()
      ? [{ label: 'businesses.wahaBaseUrl clear stale (!= env)',
          sql: `UPDATE "businesses" SET "wahaBaseUrl" = NULL WHERE "wahaBaseUrl" IS NOT NULL AND "wahaBaseUrl" <> '${process.env.WAHA_BASE_URL.trim().replace(/'/g, "''")}'` }]
      : []),
  ];
  for (const { label, sql } of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn(`[app] schema patch "${label}" skipped:`, (e as Error).message);
    }
  }
  console.log('[app] schema patches ensured.');
}

async function bootstrap() {
  // Fail fast on missing required secrets — an app running without these would
  // silently accept any token (JWT_SECRET) or lose all data (DATABASE_URL).
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
    if (!process.env[k]) throw new Error(`[app] FATAL: required env var ${k} is not set. Refusing to start.`);
    console.log(`[app] env ${k}: set`);
  }
  // Warn (don't crash) for optional AI keys
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn('[app] WARNING: neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set — AI features will return 503.');
  }

  // Infrastructure init is best-effort. A Redis/DB hiccup must NOT prevent the
  // HTTP server from binding — otherwise the platform shows "Application failed
  // to respond" with no clue. We log failures and continue; /health still works.
  try {
    await initRedis();
    await initTenantRedis();
    console.log('[app] Redis initialised.');
  } catch (e) {
    console.error('[app] Redis init FAILED (continuing so port still binds):', (e as Error).message);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    await ensureSchemaPatches();
    console.log('[app] Database reachable, schema patches ensured.');
  } catch (e) {
    console.error('[app] Database init FAILED (continuing so port still binds):', (e as Error).message);
  }

  // Reconnect any Baileys sessions that have stored credentials in Redis.
  // Runs whenever the in-process Baileys provider is active (the default
  // unless an external WAHA endpoint is configured).
  const { useBaileys } = await import('./config/whatsapp-provider');
  if (useBaileys()) {
    console.log('[app] WhatsApp provider: Baileys (in-process)');
    bootBaileySessions().catch(e =>
      console.warn('[app] Baileys boot error (non-fatal):', (e as Error).message)
    );
  } else {
    console.log('[app] WhatsApp provider: WAHA (external)');
  }

  // ── Background processing ───────────────────────────────────────
  // BullMQ workers (outbound messages, automations, webhooks) and the nightly
  // cron jobs. Both were previously never started, so queued campaign/automation
  // sends and all scheduled jobs silently never ran. Started here, best-effort:
  // a failure must never stop the HTTP server from binding. Disable on extra
  // instances with RUN_BACKGROUND_JOBS=false to avoid duplicate cron firing.
  if (process.env.RUN_BACKGROUND_JOBS !== 'false') {
    try {
      const { startAllWorkers, gracefulShutdown } = await import('./services/messaging-worker');
      const workers = startAllWorkers();
      console.log('[app] BullMQ workers started (messages, automations, webhooks).');
      for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        process.once(sig, () => {
          gracefulShutdown(workers).catch(() => {}).finally(() => process.exit(0));
        });
      }
    } catch (e) {
      console.error('[app] Worker start FAILED (continuing):', (e as Error).message);
    }
    try {
      const { startAllCronJobs } = await import('./services/cron-service');
      startAllCronJobs();
    } catch (e) {
      console.error('[app] Cron start FAILED (continuing):', (e as Error).message);
    }
  } else {
    console.log('[app] RUN_BACKGROUND_JOBS=false — workers & cron not started on this instance.');
  }

  // Behind a load balancer (Neon/Render/etc) the real client IP arrives via
  // X-Forwarded-For. Without this, express.ip is the proxy IP and rate limiting
  // collapses into a single shared bucket. Trust the first proxy hop only.
  app.set('trust proxy', 1);

  // Content Security Policy. We still rely on the Tailwind CDN (which needs
  // 'unsafe-eval'/'unsafe-inline') so we scope a policy rather than disabling it
  // outright. Tighten further once Tailwind is compiled at build time.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-eval'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc:  ["'self'", 'https:', 'wss:'],
        objectSrc:   ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS — restrict to known origins. Set CORS_ORIGINS (comma-separated) or
  // FRONTEND_URL in production; falls back to localhost dev ports. The frontend
  // is also served by this same app, so requests from our own deploy domains
  // (Railway, and any configured custom domain) are always allowed.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:3000,http://localhost:3002')
    .split(',').map(o => o.trim()).filter(Boolean);
  if (process.env.API_BASE_URL) allowedOrigins.push(process.env.API_BASE_URL.trim());

  const isAllowedOrigin = (origin: string): boolean => {
    if (allowedOrigins.includes(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      // Our own platform domains — the SPA is served from the same origin as the API.
      if (host.endsWith('.railway.app')) return true;
      if (host.endsWith('theloyaly.com') || host.endsWith('theloyaly.online')) return true;
    } catch { /* malformed origin → reject below */ }
    return false;
  };

  app.use(cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (no Origin header: WAHA, Stripe, curl, mobile).
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
      // Don't throw (which surfaces as a 500). Just deny CORS headers.
      console.warn(`[app] CORS: origin not allowed: ${origin}`);
      return cb(null, false);
    },
    credentials: true,
  }));

  // ── Stripe webhook MUST receive the raw body for signature verification.
  // Mounted BEFORE express.json() so the global JSON parser does not consume
  // the stream. express.raw sets req._body=true, so express.json skips it.
  app.use('/api/stripe', express.raw({ type: '*/*' }));
  // Lemon Squeezy webhook also needs the raw body for HMAC signature verification.
  app.use('/api/webhooks/lemonsqueezy', express.raw({ type: '*/*' }));

  app.use(express.json({ limit: '10mb' }));

  // Minimal cookie parser — the auth refresh flow reads the httpOnly
  // `refresh_token` cookie from req.cookies. (Avoids a cookie-parser dep.)
  app.use((req: any, _res, next) => {
    const header = req.headers?.cookie;
    const jar: Record<string, string> = {};
    if (typeof header === 'string') {
      for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx > -1) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k) jar[k] = decodeURIComponent(v);
        }
      }
    }
    req.cookies = jar;
    next();
  });

  // LIVENESS — used by Railway's healthcheck. MUST return 200 as long as the
  // Node process is up, even when a dependency (Redis/DB) is degraded. Returning
  // 503 here would make Railway restart-loop and kill the container during a
  // dependency blip. Dependency detail is included in the body for visibility.
  app.get('/health', async (_req, res) => {
    let redis: unknown = { ok: null };
    let db: { ok: boolean; error?: string } = { ok: true };
    try {
      const [{ redisHealth }, { prisma }] = await Promise.all([
        import('./config/redis'),
        import('./config/prisma'),
      ]);
      redis = await redisHealth();
      try { await prisma.$queryRaw`SELECT 1`; } catch (e) { db = { ok: false, error: (e as Error).message }; }
    } catch { /* never let the liveness probe throw */ }
    res.status(200).json({ status: 'ok', redis, db, ts: new Date().toISOString() });
  });

  // READINESS — strict probe for external uptime monitors: 503 when a hard
  // dependency (DB) is down. Redis being degraded is reported but NOT fatal,
  // because the app degrades gracefully without it.
  app.get('/health/ready', async (_req, res) => {
    const [{ redisHealth }, { prisma }] = await Promise.all([
      import('./config/redis'),
      import('./config/prisma'),
    ]);
    const redis = await redisHealth();
    let db: { ok: boolean; error?: string } = { ok: true };
    try { await prisma.$queryRaw`SELECT 1`; } catch (e) { db = { ok: false, error: (e as Error).message }; }
    res.status(db.ok ? 200 : 503).json({ status: db.ok ? 'ready' : 'degraded', redis, db, ts: new Date().toISOString() });
  });

  // ── API Routes ────────────────────────────────────────────────
  const loadRouter = async (modulePath: string, exportName: string, mountAt: string) => {
    try {
      const mod = await import(modulePath);
      const router = mod[exportName];
      if (!router) throw new Error(`No export "${exportName}" in ${modulePath}`);
      app.use(mountAt, router);
      console.log(`[app] ✓ ${mountAt}`);
    } catch (e) {
      console.warn(`[app] ✗ ${mountAt} skipped:`, (e as Error).message);
    }
  };

  await loadRouter('./controllers/auth-controller',       'authRouter',        '/api/auth');
  await loadRouter('./controllers/loyalty-controller',    'loyaltyRouter',     '/api/loyalty');
  await loadRouter('./controllers/campaign-controller',   'campaignRouter',    '/api/campaigns');
  // Lemon Squeezy billing MUST be mounted before the legacy campaign billing
  // router — both live at /api/billing and both define POST /checkout. First
  // match wins in Express, so LS goes first to own checkout/simulate/subscription
  // while the campaign router still serves its non-colliding routes (GET /,
  // /features/:feature, /portal).
  await loadRouter('./controllers/lemonsqueezy-controller',  'lsBillingRouter',       '/api/billing');
  await loadRouter('./controllers/campaign-controller',   'billingRouter',     '/api/billing');
  await loadRouter('./controllers/campaign-controller',   'stripeWebhookRouter','/api/stripe');
  await loadRouter('./controllers/automation-controller', 'automationRouter',  '/api/automations');
  await loadRouter('./controllers/import-controller',     'importRouter',      '/api/import');
  await loadRouter('./controllers/webhook-pos',           'posWebhookRouter',  '/api/webhooks/pos');
  await loadRouter('./controllers/ai-bi-controller',      'aiBiRouter',        '/api/ai');
  await loadRouter('./controllers/dashboard-controller',  'dashboardRouter',   '/api/dashboard');
  await loadRouter('./controllers/customers-controller',  'customersRouter',   '/api/customers');
  await loadRouter('./controllers/loyalty-engine-controller','loyaltyEngineRouter','/api/loyalty-engine');
  await loadRouter('./controllers/pos-controller',        'posRouter',         '/api/pos');
  await loadRouter('./routes/super-admin',                'adminRouter',       '/api/admin');
  await loadRouter('./controllers/whatsapp-controller',  'whatsappRouter',    '/api/whatsapp');
  await loadRouter('./controllers/messages-controller',  'messagesRouter',    '/api/messages');
  await loadRouter('./controllers/oauth-controller',     'oauthRouter',       '/api/auth');
  await loadRouter('./controllers/website-cms-controller',    'websiteCmsRouter',      '/api/website');
  await loadRouter('./controllers/customer-portal-controller','customerPortalRouter',  '/api/portal');
  await loadRouter('./controllers/upload-controller',          'uploadRouter',          '/api/upload');
  await loadRouter('./services/realtime-service',             'realtimeRouter',        '/api/realtime');
  await loadRouter('./controllers/segments-controller',       'segmentsRouter',        '/api/segments');
  await loadRouter('./controllers/integrations-controller',  'integrationsRouter',    '/api/integrations');
  await loadRouter('./controllers/totp-controller',          'totpRouter',            '/api/totp');
  await loadRouter('./controllers/hr-controller',            'hrRouter',              '/api/hr');
  await loadRouter('./controllers/ai-advisor-controller',    'aiAdvisorRouter',       '/api/ai-advisor');
  await loadRouter('./controllers/entitlements-controller',  'plansPublicRouter',     '/api/plans');
  await loadRouter('./controllers/entitlements-controller',  'entitlementsRouter',    '/api/entitlements');
  await loadRouter('./controllers/lemonsqueezy-controller',  'lsWebhookRouter',       '/api/webhooks/lemonsqueezy');

  // Serve uploaded files (menu images / PDFs)
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!require('fs').existsSync(uploadsDir)) require('fs').mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  // WAHA inbound webhook (not behind tenantScope — WAHA posts here directly)
  app.use('/api/webhooks/waha', wahaWebhookRouter);

  // ── Global error handler — catches unhandled async errors ─────
  app.use((err: any, _req: any, res: any, _next: any) => {
    const msg = err?.message ?? 'INTERNAL_ERROR';
    const status = err?.status ?? err?.statusCode ?? 500;
    console.error('[app] Unhandled error:', msg);
    if (!res.headersSent) res.status(status).json({ error: msg });
  });

  // ── Serve React frontend ──────────────────────────────────────
  const fs         = await import('fs');
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const isDev      = process.env.NODE_ENV !== 'production';

  if (!isDev && fs.existsSync(path.join(clientDist, 'index.html'))) {
    // Production: serve built static files
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  } else {
    // Development: redirect browser requests to Vite dev server on port 3000
    app.get('/', (_req, res) => res.redirect('http://localhost:3000'));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.redirect(`http://localhost:3000${req.path}`);
    });
  }

  const PORT = process.env.PORT ?? 4000;
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`[app] Running on http://0.0.0.0:${PORT}`));
}

bootstrap().catch((err) => {
  console.error('[app] Fatal:', err);
  process.exit(1);
});
