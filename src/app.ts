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
process.on('unhandledRejection', (reason) => {
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
    { label: 'consent_change_log.optOutReason',
      sql: 'ALTER TABLE "consent_change_log" ADD COLUMN IF NOT EXISTS "optOutReason" TEXT' },
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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
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
