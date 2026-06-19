# Cube Retain CRM — Complete Source Package
> Multi-tenant SaaS Customer Retention Platform
> 8 Phases · 23 Core Files · Production-Ready

---

## Directory Structure

```
cube-retain-crm/
├── prisma/
│   └── schema.prisma                        ← Phase 1
├── src/
│   ├── config/
│   │   └── redis.ts                         ← Supporting util
│   ├── utils/
│   │   ├── email.util.ts                    ← Supporting util
│   │   └── slug.util.ts                     ← Supporting util
│   ├── middleware/
│   │   └── tenantScope.ts                   ← Phase 1
│   ├── services/
│   │   ├── token.service.ts                 ← Phase 2
│   │   ├── auth.service.ts                  ← Phase 2
│   │   ├── loyalty.service.ts               ← Phase 4
│   │   ├── cron.service.ts                  ← Phase 4
│   │   ├── automation.service.ts            ← Phase 5
│   │   ├── campaign.service.ts              ← Phase 6
│   │   ├── stripe.service.ts                ← Phase 6
│   │   └── gdpr.service.ts                  ← Phase 8
│   ├── queues/
│   │   └── messaging.queue.ts               ← Phase 3
│   ├── workers/
│   │   └── messaging.worker.ts              ← Phase 3
│   ├── gateways/
│   │   └── messaging.gateway.ts             ← Phase 3
│   ├── automation/
│   │   └── automation.compiler.ts           ← Phase 5
│   ├── controllers/
│   │   ├── auth.controller.ts               ← Phase 2
│   │   ├── loyalty.controller.ts            ← Phase 4
│   │   ├── automation.controller.ts         ← Phase 5
│   │   ├── campaign.controller.ts           ← Phase 6
│   │   ├── webhook.pos.ts                   ← Phase 7
│   │   ├── ai.bi.ts                         ← Phase 7
│   │   ├── import.controller.ts             ← Phase 7
│   │   └── super.admin.controller.ts        ← Phase 8
│   └── app.ts                               ← Phase 8
├── .env.example
├── docker-compose.yml
├── tsconfig.json
└── package.json
```

---

## package.json

```json
{
  "name": "cube-retain-crm-api",
  "version": "1.0.0",
  "description": "Multi-tenant SaaS Customer Retention Platform API",
  "main": "dist/app.js",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0",
    "argon2": "^0.31.2",
    "axios": "^1.6.8",
    "bullmq": "^5.7.8",
    "cors": "^2.8.5",
    "csv-parser": "^3.0.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.2.0",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "multer": "^1.4.5-lts.1",
    "node-cron": "^3.0.3",
    "rate-limit-redis": "^4.2.0",
    "redis": "^4.6.13",
    "stripe": "^15.7.0",
    "zod": "^3.23.6"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.12.7",
    "@types/node-cron": "^3.0.11",
    "prisma": "^5.14.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "prisma"]
}
```

---

## docker-compose.yml

```yaml
version: '3.9'

services:
  api:
    build: .
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/cube_retain
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: cube_retain
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  bullmq-dashboard:
    image: deadly0/bull-board
    ports:
      - "3001:3000"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - redis

volumes:
  postgres_data:
  redis_data:
```

---

## .env.example

```env
# Server
PORT=4000
NODE_ENV=development
API_BASE_URL=http://localhost:4000
API_DOMAIN=api.cuberetain.com
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/cube_retain

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-chars

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_FREE_M=price_...
STRIPE_PRICE_STARTER_M=price_...
STRIPE_PRICE_STARTER_A=price_...
STRIPE_PRICE_GROWTH_M=price_...
STRIPE_PRICE_GROWTH_A=price_...
STRIPE_PRICE_PROFESSIONAL_M=price_...
STRIPE_PRICE_PROFESSIONAL_A=price_...
STRIPE_PRICE_ENTERPRISE_M=price_...
STRIPE_PRICE_ENTERPRISE_A=price_...

# Meta WhatsApp Cloud API
META_APP_SECRET=your-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=your-webhook-verify-token

# OpenAI (Phase 7 - AI BI)
OPENAI_API_KEY=sk-...

# Email (configure with SendGrid or Nodemailer)
SENDGRID_API_KEY=SG...
EMAIL_FROM=noreply@cuberetain.com

# Feature flags
DISABLE_CRON=false
```

---

## src/config/redis.ts

```typescript
import { createClient, RedisClientType } from 'redis';

let _client: RedisClientType | null = null;

export const initRedis = async (): Promise<void> => {
  _client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
  _client.on('error', (err) => console.error('[redis] Client error:', err));
  await _client.connect();
  console.log('[redis] Connected.');
};

export const getRedisClient = (): RedisClientType => {
  if (!_client) throw new Error('[redis] Client not initialized. Call initRedis() at startup.');
  return _client;
};

// BullMQ expects a plain ioredis-compatible connection object
export const getRedisConnection = () => ({
  host: new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').hostname,
  port: parseInt(new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').port || '6379', 10),
});
```

---

## src/utils/email.util.ts

```typescript
// Email utility — wire to SendGrid, Nodemailer, Resend, or Postmark
// Replace the stub body with your chosen provider's SDK call.

export interface EmailOptions {
  to:          string;
  subject:     string;
  templateId:  string;
  variables:   Record<string, unknown>;
}

export const sendEmail = async (opts: EmailOptions): Promise<void> => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[email] DEV → To: ${opts.to} | Template: ${opts.templateId}`, opts.variables);
    return;
  }

  // ── SendGrid example ──────────────────────────────────────────
  // const sgMail = require('@sendgrid/mail');
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  // await sgMail.send({
  //   to:          opts.to,
  //   from:        process.env.EMAIL_FROM!,
  //   templateId:  opts.templateId,
  //   dynamicTemplateData: opts.variables,
  // });
  // ─────────────────────────────────────────────────────────────

  console.warn(`[email] No provider configured. Email to ${opts.to} was not sent.`);
};
```

---

## src/utils/slug.util.ts

```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Generate a URL-safe slug from a business name.
 * Appends a numeric suffix if the slug is already taken.
 */
export const generateBusinessSlug = async (name: string): Promise<string> => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  let slug    = base;
  let attempt = 0;

  while (true) {
    const existing = await prisma.business.findUnique({ where: { slug } });
    if (!existing) return slug;
    attempt++;
    slug = `${base}-${attempt}`;
  }
};
```

---

# PHASE 1 — FOUNDATION

> **Files:** `prisma/schema.prisma` · `src/middleware/tenantScope.ts`
> See artifacts: **prisma-schema** · **tenant-scope-middleware**

Key decisions:
- Every operational table has `businessId` (tenant boundary)
- 7 customer segments: `NEW | LOYAL | VIP | AT_RISK | LOST | BIG_SPENDER | COUPON_HUNTER`
- 9 message statuses: `PENDING | QUEUED | SENT | DELIVERED | READ | FAILED | CONSENT_REVOKED | DROPPED_COOLDOWN | DROPPED_QUOTA`
- 6 RBAC roles: `PLATFORM_ADMINISTRATOR | TENANT_OWNER | BRANCH_MANAGER | CASHIER | MARKETING_STAFF | CUSTOMER`
- `tenantScope.ts` injects businessId from JWT; Branch Managers auto-scoped to branchLocationId
- Redis-backed token revocation blacklist (HTTP-only refresh cookie)

---

# PHASE 2 — AUTHENTICATION

> **Files:** `src/services/token.service.ts` · `src/services/auth.service.ts` · `src/controllers/auth.controller.ts`
> See artifacts: **token-service** · **auth-service** · **auth-controller**

Key decisions:
- Argon2id: 64 MiB memory, 3 iterations, parallelism 4 (OWASP 2024 minimum)
- Refresh token stored as Argon2id hash; raw token travels once via HTTP-only cookie
- Token theft detection: mismatched refresh token nulls the hash → forces full re-login
- `performDummyVerify()` on login-not-found path prevents timing-based email enumeration
- Staff invite flow uses SHA-256 token in Redis (48h TTL, single-use)
- Rate limiters: 10 logins/15min, 5 registrations/hr, 5 password resets/hr

---

# PHASE 3 — MESSAGING INFRASTRUCTURE

> **Files:** `src/queues/messaging.queue.ts` · `src/workers/messaging.worker.ts` · `src/gateways/messaging.gateway.ts`
> See artifacts: **messaging-queue** · **messaging-worker** · **messaging-gateway**

Key decisions:
- Zero synchronous sends. Every outbound message goes through BullMQ
- 7 sequential pre-flight checks before any network call (cheapest first)
- Per-tenant soft-pause via Redis flag (not global queue pause — other tenants unaffected)
- Quota DECR is atomic in Redis — no race condition across concurrent workers
- WAHA opt-out: `STOP/UNSUBSCRIBE` in inbound message → `isSuppressed=true` + `ConsentChangeLog`
- Sentiment heuristics on inbound → `marketingPausedUntil` + Manager Alert

**Pre-flight check order:**
1. Tenant queue paused? → DROPPED_QUOTA
2. Customer exists? → FAILED
3. Customer suppressed? → CONSENT_REVOKED
4. Channel consent flag? → CONSENT_REVOKED
5. Marketing paused (negative sentiment)? → DROPPED_COOLDOWN
6. Within 72h cooldown window? → DROPPED_COOLDOWN
7. Quota exhausted? → DROPPED_QUOTA
✅ Send via Meta or WAHA gateway

---

# PHASE 4 — LOYALTY ENGINE

> **Files:** `src/services/loyalty.service.ts` · `src/services/cron.service.ts` · `src/controllers/loyalty.controller.ts`
> See artifacts: **loyalty-service** · **cron-service** · **loyalty-controller**

Key decisions:
- `RewardPointsLedger` is append-only — CREDIT/DEBIT rows only, never overwrite
- `currentPointsBalance` is a denormalized cache updated atomically alongside ledger append
- Coupon redemption uses raw `SELECT ... FOR UPDATE` inside `$transaction` → prevents double-spend
- Referral conversion: signup coupon + referrer credit in single `$transaction` — atomic
- Birthday automation: `EXTRACT(MONTH/DAY FROM birthday)` match (not year); `isPromotional=false` bypasses cooldown
- Cron schedule: 00:30 birthdays, 01:00 segment refresh, 01:05 analytics snapshot, 01:15 inactivity queue
- Analytics snapshot uses `upsert` keyed on `(businessId, snapshotDate, null)` — idempotent

---

# PHASE 5 — REACTFLOW AUTOMATION COMPILER

> **Files:** `src/automation/automation.compiler.ts` · `src/services/automation.service.ts` · `src/controllers/automation.controller.ts`
> See artifacts: **automation-compiler** · **automation-service** · **automation-controller**

Key decisions:
- Visual graph NEVER executed directly — always compiled first to `compiledJson`
- BFS traversal accumulates `delayMinutes` across DelayNodes as absolute offset from trigger-fire
- `sourceHandle: 'yes' | 'no'` on edges tags downstream actions with `branchConditions[]`
- `evaluateActionConditions()` exported and used identically by service + BullMQ worker
- DFS cycle detection prevents infinite traversal loops
- Activation gate: checks schema version + blocks duplicate trigger types in same business
- `/preview` endpoint: compile without saving (powers canvas "Validate" button)

**Supported trigger types:** BIRTHDAY · INACTIVITY · VISIT_MILESTONE · TIER_UPGRADE · SENTIMENT_NEGATIVE · SPEND_THRESHOLD · REFERRAL_CONVERTED

**Supported action types:** SEND_WHATSAPP · SEND_EMAIL · AWARD_POINTS · DEDUCT_POINTS · CHANGE_SEGMENT · CREATE_COUPON · MANAGER_ALERT

---

# PHASE 6 — CAMPAIGN BUILDER + STRIPE

> **Files:** `src/services/campaign.service.ts` · `src/services/stripe.service.ts` · `src/controllers/campaign.controller.ts`
> See artifacts: **campaign-service** · **stripe-service** · **campaign-controller**

Key decisions:
- `buildMessagePayloadFromLayout()` is the single bridge from @dnd-kit canvas JSON to WhatsApp payload
- Block priority: VIDEO > IMAGE > TEXT; buttons appended as plain text for WAHA
- Quota headroom check BEFORE creating DB records (fail fast; don't create 5,000 orphan rows)
- Bulk campaign uses `addBulk` in 500-job chunks with 10ms per-job stagger
- Stripe webhook: `stripe.webhooks.constructEvent()` validates HMAC before any business logic
- `invoice.paid` → DB subscription update + Redis quota key reset + `resumeTenantQueue()`
- Feature flags stored as Redis Set: `tenant:features:{businessId}` (Enterprise = wildcard `'*'`)
- **Mount order:** Stripe webhook BEFORE `express.json()` (raw Buffer required for HMAC)

**Tier quotas:** FREE=500 · STARTER=2,500 · GROWTH=10,000 · PROFESSIONAL=50,000 · ENTERPRISE=unlimited

---

# PHASE 7 — POS WEBHOOKS + AI BI + CSV IMPORT

> **Files:** `src/controllers/webhook.pos.ts` · `src/controllers/ai.bi.ts` · `src/controllers/import.controller.ts`
> See artifacts: **webhook-pos** · **ai-bi-controller** · **import-controller**

Key decisions:
- POS: responds 200 immediately (before processing) — POS systems retry on slow responses
- POS idempotency: `UNIQUE(transactionId, businessId)` in `PosWebhookLog` prevents duplicate visits
- AI BI: two-pass LLM — Pass 1 classifies intent → named query; Pass 2 generates insight from results
- LLM never executes queries, never sees raw SQL, never receives cross-tenant data
- `businessId` injected server-side in Pass 1 query execution — LLM cannot influence it
- CSV: `/preview-headers` returns column names → frontend renders drag-and-drop mapping UI
- CSV streaming: `csv-parser` + `Readable.from(buffer)` — handles files up to 10MB, 50,000 rows
- Batch upsert: 100 rows per `$transaction` — one bad row rolls back that chunk, not the full import
- Phone normalization: `07xxx` → `+447xxx`, `00xx` prefix, E.164 passthrough

**AI query library (10 named functions):**
getInactiveCustomers · getTopSpenders · getNewCustomers · getSegmentBreakdown ·
getCampaignPerformance · getRevenueStats · getBirthdaysThisMonth ·
getChurnRiskCustomers · getLoyaltyStats · getMessageQueueHealth

---

# PHASE 8 — GDPR + SUPER ADMIN + APP BOOTSTRAP

> **Files:** `src/services/gdpr.service.ts` · `src/controllers/super.admin.controller.ts` · `src/app.ts`
> See artifacts: **gdpr-service** · **super-admin** · **app-bootstrap**

Key decisions:
- GDPR: pseudonymize over hard-delete (preserve FK integrity + anonymized revenue data)
- 8 PII fields cleared; 5 content tables hard-deleted; AuditLog entry = ICO/regulator proof
- Visit.amountSpent + CouponRedemptionLog retained under GDPR Article 89 (statistical purposes)
- Super Admin `suspendTenant` writes to Redis immediately (`markBusinessSuspendedInCache`) → blocks within ms
- Impersonation token: 1h, non-renewable, PLATFORM_ADMINISTRATOR only, every request audited
- White-label: `Host` header → Business.customDomain → brandingColors JSONB → CSS variables
- `/api/public/branding?domain=...` → consumed by Next.js `layout.tsx` for `:root` injection

**App mount order (non-negotiable):**
1. Stripe webhook (raw body)
2. CORS + Helmet
3. express.json()
4. Rate limiting
5. White-label middleware
6. All routers
7. Error handler
8. BullMQ workers start
9. Cron jobs start

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/cube-retain-crm-api
cd cube-retain-crm-api
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Start infrastructure
docker-compose up -d db redis

# 4. Run database migrations
npm run db:generate
npm run db:migrate

# 5. Start development server
npm run dev
# API running on http://localhost:4000

# 6. (Optional) Open Prisma Studio
npm run db:studio

# 7. (Optional) BullMQ dashboard
# http://localhost:3001
```

---

## API Route Reference

| Method | Route | Phase | Auth |
|--------|-------|-------|------|
| POST | `/api/auth/register` | 2 | Public |
| POST | `/api/auth/login` | 2 | Public |
| POST | `/api/auth/logout` | 2 | JWT |
| POST | `/api/auth/refresh` | 2 | Cookie |
| POST | `/api/auth/forgot-password` | 2 | Public |
| POST | `/api/auth/reset-password` | 2 | Public |
| POST | `/api/auth/invite` | 2 | OWNER |
| POST | `/api/auth/accept-invite` | 2 | Public |
| POST | `/api/auth/impersonate/:id` | 2 | PLATFORM_ADMIN |
| GET | `/api/auth/me` | 2 | JWT |
| GET | `/api/loyalty/:id/profile` | 4 | JWT |
| POST | `/api/loyalty/checkin` | 4 | JWT |
| POST | `/api/loyalty/:id/redeem` | 4 | CASHIER+ |
| GET/PUT | `/api/loyalty/tiers` | 4 | OWNER |
| POST | `/api/loyalty/referral/apply` | 4 | JWT |
| GET | `/api/automations` | 5 | JWT |
| POST | `/api/automations` | 5 | OWNER |
| POST | `/api/automations/:id/activate` | 5 | OWNER |
| POST | `/api/automations/:id/trigger/:cid` | 5 | OWNER |
| POST | `/api/automations/preview` | 5 | JWT |
| GET | `/api/campaigns` | 6 | JWT |
| POST | `/api/campaigns` | 6 | OWNER |
| POST | `/api/campaigns/:id/launch` | 6 | OWNER |
| POST | `/api/campaigns/:id/schedule` | 6 | OWNER |
| POST | `/api/campaigns/preview-payload` | 6 | JWT |
| GET | `/api/billing` | 6 | OWNER |
| POST | `/api/billing/checkout` | 6 | OWNER |
| POST | `/api/billing/portal` | 6 | OWNER |
| POST | `/api/webhooks/stripe` | 6 | Raw+HMAC |
| POST | `/api/webhooks/meta` | 3 | HMAC |
| POST | `/api/webhooks/waha/:bizId` | 3 | Public+IP |
| POST | `/api/webhooks/pos/:provider` | 7 | X-Api-Key |
| POST | `/api/ai/query` | 7 | JWT |
| GET | `/api/ai/manifest` | 7 | JWT |
| POST | `/api/import/preview-headers` | 7 | OWNER |
| POST | `/api/import/customers` | 7 | OWNER |
| GET | `/api/admin/metrics` | 8 | PLATFORM_ADMIN |
| GET | `/api/admin/tenants` | 8 | PLATFORM_ADMIN |
| POST | `/api/admin/tenants/:id/suspend` | 8 | PLATFORM_ADMIN |
| POST | `/api/admin/impersonate/:id` | 8 | PLATFORM_ADMIN |
| POST | `/api/admin/force-logout/:uid` | 8 | PLATFORM_ADMIN |
| GET | `/api/admin/system-health` | 8 | PLATFORM_ADMIN |
| GET | `/api/gdpr/export/:id` | 8 | OWNER |
| DELETE | `/api/gdpr/purge/:id` | 8 | OWNER |
| PATCH | `/api/gdpr/consent/:id` | 8 | JWT |
| GET | `/api/public/branding` | 8 | Public |
| GET | `/health` | 8 | Public |

---

## Security Checklist

- [x] Argon2id password hashing (OWASP 2024 params)
- [x] JWT access tokens (15min) + HTTP-only refresh cookie (7d)
- [x] Refresh token rotation with theft detection
- [x] Redis token revocation blacklist
- [x] Row-level tenant isolation (businessId on every table)
- [x] Branch Manager auto-scope (branchLocationId injected by middleware)
- [x] Stripe webhook HMAC-SHA256 signature verification
- [x] Meta webhook HMAC-SHA256 signature verification
- [x] POS webhook API key authentication (SHA-256 hash stored)
- [x] Rate limiting on all public endpoints (Redis-backed)
- [x] Helmet.js security headers + CSP
- [x] CORS with origin whitelist
- [x] BullMQ pre-flight consent checks (7 checks before every send)
- [x] GDPR opt-out interceptor (STOP keyword → immediate suppression)
- [x] AI BI: LLM never executes queries or sees raw SQL
- [x] Impersonation fully audited (every request logged)
- [x] Graceful shutdown (SIGTERM/SIGINT)

---

## Data Flow Summary

```
Customer Check-In (QR / POS Webhook)
    ↓
Visit Created → Points Accrued → Tier Evaluated
    ↓
Segment Classification (nightly cron)
    ↓
AutomationWorkflow Triggered (BullMQ)
    ↓
[Compiler: graphJson → compiledJson → executable actions]
    ↓
Pre-flight: consent · suppression · cooldown · quota
    ↓
MessageQueue → BullMQ Worker → Meta/WAHA Gateway
    ↓
Delivery Status → WebSocket / Dashboard
    ↓
Inbound Reply → Sentiment Analysis → OptOut / Manager Alert
```

---

*Built in 8 phases across Phases 1–8. All 23 source files available as individual artifacts in this conversation.*
