# Loyable — WhatsApp-First Customer Retention OS

**Loyable** is a multi-tenant SaaS platform that turns WhatsApp into a complete customer-retention engine for small and medium businesses: loyalty points, membership tiers, a digital wallet, drag-and-drop campaigns, visual automations, a built-in point-of-sale, AI business intelligence, and a self-service customer portal — all built around the one channel SMB customers actually read. It runs in production on Railway, serves both the marketing website and the tenant application from a single Node process, and has been load-verified at one million customers across twenty tenants.

This document is the complete A-to-Z report of the product: what it does, how it is built, every external service it depends on, how it is deployed, and the full history of what has been shipped to date.

---

## Table of Contents

1. [Product Philosophy](#1-product-philosophy)
2. [The Story So Far — A to Z](#2-the-story-so-far--a-to-z)
3. [Complete Feature Catalogue](#3-complete-feature-catalogue)
4. [System Architecture](#4-system-architecture)
5. [Technology Stack & Third-Party APIs](#5-technology-stack--third-party-apis)
6. [The Database](#6-the-database)
7. [The Messaging Pipeline](#7-the-messaging-pipeline)
8. [Scheduled Jobs (Cron)](#8-scheduled-jobs-cron)
9. [Email Subsystem](#9-email-subsystem)
10. [Billing & Subscriptions](#10-billing--subscriptions)
11. [Complete API Reference](#11-complete-api-reference)
12. [Security Model](#12-security-model)
13. [Build & Local Development](#13-build--local-development)
14. [Production Deployment](#14-production-deployment)
15. [Environment Variables](#15-environment-variables)
16. [Load Testing](#16-load-testing)
17. [Changelog — What Has Been Shipped](#17-changelog--what-has-been-shipped)
18. [Roadmap](#18-roadmap)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Product Philosophy

Loyable is built for one kind of user: the non-technical owner of a café, salon, gym, clinic, or retail shop. From their seat the product is intentionally simple — scan a QR code to connect WhatsApp, add customers, send messages, watch the loyalty and revenue numbers move. Everything underneath that surface is owned by the SaaS operator.

That single principle drives a hard rule across the whole codebase: **never leak infrastructure to the tenant.** Session IDs, gateway base URLs, API keys, queue names, engine types — none of it is ever shown in the tenant UI. A business owner sees "Connect WhatsApp" and a green "Connected" banner; they never learn that behind it sits a WAHA container or an in-process Baileys socket, a BullMQ queue on Redis, and a per-tenant set of credentials on their `Business` row. All technical complexity is the operator's to carry.

The second principle is **trust through correctness.** This is a system that spends real money (messages cost quota), touches real consent law (GDPR opt-outs), and moves loyalty value that is effectively a currency. So the loyalty ledger is immutable and append-only, points credits are idempotent at the database level, consent changes are audited, and every outbound message passes seven independent pre-flight checks before a single byte leaves the building.

---

## 2. The Story So Far — A to Z

Loyable began life under the internal name *Cube Retain CRM* (the npm package is still `cube-retain-crm-api`) and has since been rebranded to Loyable, trading on the domains `theloyaly.com` / `theloyaly.online`. The journey, in order:

**A — Foundations.** A multi-tenant Express + TypeScript API was stood up with Prisma over PostgreSQL, Redis for caching and queues, and a strict `tenantScope` middleware that injects a verified tenant context into every authenticated request. The data model was designed tenant-first: every operational table carries a `businessId` and every index leads with it.

**B — Identity & roles.** JWT access/refresh authentication landed, with Argon2id password hashing, per-device sessions, a Redis token blacklist for instant revocation, and a six-level role hierarchy from `PLATFORM_ADMINISTRATOR` down to `CUSTOMER`. Google OAuth was wired in as an alternative sign-in.

**C — The loyalty engine.** Points accrual, membership tiers, a high-precision digital wallet, and an immutable reward-points ledger were built. Customers earn points per pound spent plus a flat per-visit bonus; tiers are threshold-based; the wallet stores currency value to two decimal places.

**D — Segmentation.** Seven AI-style segments (NEW, LOYAL, VIP, AT_RISK, LOST, BIG_SPENDER, COUPON_HUNTER) are computed nightly from recency and spend, with a full segment-change history for audit.

**E — Messaging.** The dual-gateway messaging layer was created: a self-hosted **WAHA** path and an in-process **Baileys** path, behind a single `routeMessage()` entry point. Campaigns and automations enqueue jobs through BullMQ; a worker runs seven pre-flight checks before dispatch.

**F — Campaigns & automations.** A drag-and-drop campaign builder (serialising a block layout to JSON) and a node-graph automation builder (reactflow → compiled executable definition) were added, targeting segments across WhatsApp/email/SMS channels.

**G — Commerce.** A built-in POS was added so businesses can take counter payments, auto-accrue loyalty points on every sale, and let customers pay with points via the wallet. For the Pakistani market, FBR e-invoicing (PRAL/IRIS integration, GST, QR-coded fiscal receipts) was layered on.

**H — The customer portal.** A slug-based, OTP-over-WhatsApp self-service portal lets end customers check their points, tier, visit history, referral code, and the venue's menu/Wi-Fi/announcements.

**I — Growth surface.** A fully CMS-driven marketing website (features, pricing, testimonials, partners, blog, FAQ, banners, public reviews) was built so the operator can edit landing-page content without deploying code.

**J — Billing.** Stripe subscriptions across five tiers (FREE → ENTERPRISE) with quota enforcement mirrored into Redis, a billing portal, and webhook-driven tier/quota sync.

**K — Intelligence.** An AI BI controller answers natural-language questions about the tenant's data and generates message copy, backed by OpenAI.

**L — Hardening & polish (most recent work).** Loyalty points now genuinely accrue on every POS sale; phone numbers normalise to E.164 everywhere so one customer never splits into two records; the campaign builder saves and launches real campaigns with live delivery stats; transactional email actually sends via Resend/SendGrid/SMTP; the marketing site was redesigned to be responsive and CDN-independent; birthday bonus points became configurable and are now actually awarded (idempotently, once per customer per year); Tailwind moved from the Play CDN to a compiled PostCSS build; the BullMQ Redis connection got TLS + keep-alive to stop Upstash `ECONNRESET`; libsignal log spam was silenced; and a batch of pre-existing TypeScript and JSX build errors were fixed so the production build is clean. The platform was load-verified at 1,000,000 customers across 20 tenants, which fed a covering index back into the schema.

That is where the product stands today: feature-complete across loyalty, messaging, commerce, billing, and analytics, deployed on Railway, and serving live tenants.

---

## 3. Complete Feature Catalogue

### 3.1 Multi-Tenancy & Access Control
- **Tenant isolation** on every table via `businessId`; enforced in middleware, not trusted from request bodies.
- **Six roles:** `PLATFORM_ADMINISTRATOR` (operator super-admin), `TENANT_OWNER`, `BRANCH_MANAGER` (scoped to one branch), `CASHIER` (QR + PIN transaction operations), `MARKETING_STAFF` (campaigns + customer data, no billing), and `CUSTOMER` (portal only).
- **Multi-branch** businesses: locations, branch-scoped staff, branch-level analytics rollups.
- **Operator impersonation** of any tenant for support, fully audit-logged.

### 3.2 WhatsApp Connectivity
- **Dual gateway.** WAHA (self-hosted WhatsApp HTTP API, NOWEB engine) *or* Baileys (in-process socket) behind one gateway. Setting `WHATSAPP_PROVIDER=baileys` routes all tenants through Baileys; otherwise each `Business` carries its own WAHA config.
- **QR onboarding.** Tenant scans once in Settings → status flips to a green "Connected" banner. Sessions persist across restarts.
- **Number warmup & failover.** New numbers ramp daily volume to avoid bans (`warmupEnabled`, `dailyMessageCapOverride`); primary/backup session slots with health-check-driven failover (`wahaActiveSlot`, `wahaHealthFailCount`, `wahaLastHealthyAt`).
- **Two-way inbox.** Inbound messages are stored, threaded by chat, and shown with customer name + number; staff can reply, broadcast, and send direct messages.

### 3.3 Loyalty Engine
- **Points accrual:** configurable points-per-pound plus a flat per-visit bonus; credited automatically on every POS sale and check-in.
- **Membership tiers:** drag-ordered Bronze/Silver/Gold/VIP-style tiers with visit-count or spend thresholds and JSON-defined benefits.
- **Immutable reward-points ledger:** append-only, with a denormalised running balance for O(1) reads and a unique `(customerId, reason, referenceId)` constraint that makes credits idempotent — concurrent writes for the same visit can never double-credit.
- **Digital wallet:** separate high-precision (`Decimal(12,2)`) ledger for stored value; customers can pay with points at the counter (`redeemRate`, `minRedeemPoints`).
- **Points expiry:** points older than `pointsExpiryDays` (default 365) expire nightly via a DEBIT ledger entry.
- **Tier demotion:** a nightly job re-evaluates tiers so inactive VIPs don't keep a status that devalues the tier for active customers.
- **Birthday bonus points:** configurable bonus awarded automatically on a customer's birthday, idempotent per year.
- **Referrals:** every customer gets a unique referral code; conversions credit points.

### 3.4 Segmentation
Seven segments computed nightly (and event-driven on visits): NEW, LOYAL, VIP, AT_RISK, LOST, BIG_SPENDER, COUPON_HUNTER. Thresholds (`loyalDaysWindow`, `lostDaysThreshold`, `bigSpenderThreshold`, etc.) are per-business. Every transition is recorded in `CustomerSegmentHistory`.

### 3.5 Campaigns
- Drag-and-drop block builder (text, image, coupon, URL-button) serialised to `layoutJson`.
- Audience targeting by segment, channel selection, immediate launch or scheduled send.
- **Campaign cloning** (`POST /campaigns/:id/clone`) for fast iteration.
- Live denormalised stats: sent / delivered / read / failed / dropped.

### 3.6 Automations
- Visual node-graph builder (reactflow) saved as `graphJson`, then **compiled** server-side into an executable `compiledJson` (trigger + ordered actions).
- Triggers: BIRTHDAY, INACTIVITY, VISIT_MILESTONE, TIER_UPGRADE, SENTIMENT_NEGATIVE, REFERRAL_CONVERTED, SPEND_THRESHOLD.
- Actions: send WhatsApp/email, award points, and more.
- Per-customer run records with de-duplication so a customer isn't hit twice by the same workflow.
- A **Test Fire** button runs a workflow against a single chosen customer.

### 3.7 Built-in POS & FBR E-Invoicing
- Counter sales create a `Visit`, accrue points, and return `pointsEarned` to the cashier UI.
- Wallet/points payment: bill adjusts automatically against the customer's balance.
- Printable, branded receipts (business logo + currency).
- **FBR (Pakistan) e-invoicing:** PRAL/IRIS submission, NTN/STRN, configurable GST, fiscal QR code, sandbox vs live mode, and a retry endpoint for failed submissions.

### 3.8 Customer Portal
- Public, slug-based (`/portal/:slug`) self-service app.
- **OTP login over WhatsApp** — no passwords for end customers.
- Shows points, tier progress, visit history, referral code/share, and operator-curated content (menu image, Wi-Fi, announcements) — visible only *after* login.

### 3.9 Analytics & AI BI
- Nightly `AnalyticsSnapshot` per business/branch: cohort counts, visits, revenue, AOV, churn/retention rates, LTV, messaging metrics, campaign conversions, coupon redemptions, referrals.
- **AI BI:** natural-language query endpoint and AI message-copy generation backed by OpenAI.

### 3.10 GDPR & Consent
- Granular per-channel consent flags (WhatsApp / email / SMS / push).
- Opt-out keywords (STOP/UNSUBSCRIBE) set `isSuppressed`, write a `ConsentChangeLog` row, and invalidate the Redis cache.
- Immutable `AuditLog` for all sensitive actions; a GDPR service for data export/erasure.

### 3.11 Feedback / NPS
- `FeedbackResponse` model captures 1–5 star ratings collected via WhatsApp quick-reply after a visit, dispatched by an hourly job.

### 3.12 Import & Integrations
- CSV customer import with header preview and E.164 phone normalisation.
- POS webhook ingestion (Square/Toast/Clover/custom) with idempotency on `transactionId`.
- Outbound webhooks (HMAC-signed) for events like `CUSTOMER_REACHED_VIP`, `COUPON_REDEEMED`, `TIER_UPGRADED`.
- Tenant-scoped API keys with scopes for an open API layer.

### 3.13 Marketing Website CMS
Operator-editable landing page: settings, sections, feature cards, pricing plans, testimonials, partners, public reviews (with moderation + replies), blog posts, FAQ, announcement banners, and page-view analytics — all served from the same app.

---

## 4. System Architecture

### Backend (`src/`)
Express on port 4000 (Railway injects `PORT` in production). The entry point `src/app.ts`:
1. Installs crash-visibility handlers (`unhandledRejection`, `uncaughtException`) so nothing dies silently in platform logs.
2. Logs which critical secrets are present (never their values).
3. Best-effort-initialises Redis and Prisma — **a Redis or DB hiccup never prevents the HTTP port from binding**, so `/health` always answers.
4. Runs idempotent, additive **self-healing schema patches** (`ALTER TABLE … IF NOT EXISTS`, index creation, stale-URL cleanup) so additive columns exist even before `prisma db push` runs.
5. Configures Helmet CSP, origin-aware CORS (allows `*.railway.app`, `theloyaly.com/.online`), a raw-body mount for Stripe, a 10 MB JSON parser, and a minimal cookie parser.
6. Dynamically loads every router with `loadRouter()` — **a router that fails to import is skipped with a warning, not a crash.**
7. Serves the built React SPA in production, or redirects to the Vite dev server in development.

**Request lifecycle:** `HTTP → tenantScope middleware → controller → service/gateway`. The `tenantScope` middleware verifies the JWT, checks Redis for token revocation, validates the `businessId`, and injects `req.tenantContext` (`userId`, `businessId`, `branchLocationId`, `role`, `isImpersonating`).

### Frontend (`client/`)
A React 18 + Vite + TypeScript single-page app. The whole tenant UI lives in `CRM.tsx`; `LoyableAdminPanel.tsx` is the operator console; `CustomerPortal.tsx` is the end-customer app; `TermsAndConditions.tsx` is the legal page. All API calls flow through `client/src/api/index.ts`, which attaches the JWT, transparently refreshes on 401, and throws typed errors. Styling is compiled Tailwind (PostCSS), no longer the Play CDN.

### Directory map
```
client/                React 18 + Vite SPA (tenant app, admin panel, portal, website)
src/
  app.ts               Express bootstrap — schema patches, routers, SPA serving
  controllers/         HTTP handlers (auth, loyalty, campaigns, automations, pos, ai, …)
  services/            Business logic (messaging, loyalty, campaigns, cron, stripe, fbr, baileys, …)
  middleware/          tenantScope (multi-tenant isolation + JWT + revocation)
  routes/              super-admin router
  utils/               email, phone (E.164), pagination, slug
  config/              prisma, redis, waha
prisma/
  schema.prisma        Full multi-tenant schema
  seed.ts              Demo tenant + accounts
scripts/               load-test, waha-fix, fresh-dev
waha/                  WAHA Core (self-hosted WhatsApp HTTP API)
Dockerfile             3-stage production build
railway.json           Railway deploy config
```

---

## 5. Technology Stack & Third-Party APIs

| Layer | Technology / Service | Role |
|-------|---------------------|------|
| Runtime | **Node.js 20** | Backend + build |
| Web framework | **Express 4** | HTTP API + SPA host |
| Language | **TypeScript 5** | Backend & frontend |
| Frontend | **React 18 + Vite** | SPA, drag-drop builders |
| CSS | **Tailwind 3 (PostCSS)** | Compiled at build time |
| ORM | **Prisma 5** | Type-safe DB access |
| Database | **PostgreSQL (Neon)** | Primary data store |
| Cache / Queue store | **Redis (Upstash, TLS)** | JWT blacklist, tenant cache, quota mirror, BullMQ |
| Job queue | **BullMQ 5** | Campaign/automation message dispatch |
| Scheduler | **node-cron** | Nightly/hourly jobs |
| WhatsApp (A) | **WAHA** (self-hosted) | HTTP WhatsApp gateway |
| WhatsApp (B) | **Baileys 7** | In-process WhatsApp socket |
| Payments | **Stripe** | Subscriptions, billing portal, webhooks |
| AI | **OpenAI** | NL business queries, copy generation |
| Email | **Resend / SendGrid / SMTP** | Transactional email (auto-detected) |
| Tax (PK) | **FBR PRAL / IRIS** | Fiscal e-invoicing |
| Media | **Cloudflare R2** (S3-compatible) | Uploads |
| Auth | **JWT + Argon2id + Google OAuth** | Sessions & sign-in |
| Validation | **Zod** | Request schema validation |
| Security | **Helmet, express-rate-limit, CORS** | Hardening |
| Hosting | **Railway** (Docker) | Production deploy |
| Errors | **Sentry** (optional) | Monitoring |

---

## 6. The Database

PostgreSQL via Prisma, hosted on Neon (pooled connection URL). Every operational table is tenant-scoped and indexed `businessId`-first. The headline models:

- **Business** — one row per tenant. Holds branding, portal settings (JSON), messaging-provider config (Meta/WAHA/Baileys credentials), warmup/failover state, all operational thresholds (cooldown hours, loyalty windows, points-per-pound, big-spender threshold, redeem rate, points expiry), FBR/tax config, and currency/timezone.
- **BranchLocation** — multi-branch support with geolocation check-in radius.
- **User** + **UserSession** — staff/owners with Argon2id hashes, Google IDs, and per-device refresh sessions (unlimited concurrent logins).
- **Customer** — the core CRM entity: identity, E.164 WhatsApp number, segment, denormalised metrics (visit count, total spend, AOV, points/wallet balances), granular consent flags, suppression/pause flags, and AI sentiment.
- **Visit** — POS/QR check-ins with idempotency on `transactionId`, FBR invoice fields, and revenue-attribution links (`attributedCampaignId`, `attributedAutomationId`, 48h window).
- **LoyaltyTier** + **CustomerTierHistory** — tier definitions and the audit trail of tier changes.
- **RewardPointsLedger** — immutable, append-only, idempotent via `@@unique([customerId, reason, referenceId])`.
- **WalletLedger** — high-precision stored-value ledger.
- **Coupon** + **CouponRedemptionLog** — coupons with cashier-PIN redemption, offline-PWA sync fields, and an immutable redemption audit trail.
- **MessageQueue** — every outbound message with channel, provider, status, payload, delivery timestamps, scheduling, and promotional flag. Status enum includes the drop reasons `CONSENT_REVOKED`, `DROPPED_COOLDOWN`, `DROPPED_QUOTA`.
- **Campaign** / **AutomationWorkflow** + **AutomationRun** — the builders' persisted state and per-customer execution records.
- **AnalyticsSnapshot** — nightly pre-computed KPIs, upsert-keyed for idempotent re-runs.
- **Subscription** — Stripe tier, status, period, and quota mirrored to Redis.
- **ApiKey**, **OutboundWebhookConfig/Delivery**, **ConsentChangeLog**, **AuditLog**, **PosWebhookLog** — the integration, consent, and audit surfaces.
- **FeedbackResponse**, **WhatsAppMessage**, **PortalLogin** — NPS, inbox storage, and portal access logs.
- **Website CMS models** — WebsiteSetting, WebsiteSection, FeatureCard, PricingPlan, CmsTestimonial, PartnerBusiness, PublicReview, BlogPost, FaqItem, AnnouncementBanner, WebsitePageView.

Notable indexing decisions: a covering index `(businessId, segment, lastVisitAt)` keeps the Customers list view off sequential scans at scale; cursor-pagination indexes `(businessId, isActive, id)` keep nightly cron jobs efficient on large tenants; compound message-queue indexes make the cooldown interceptor a sub-5ms lookup.

---

## 7. The Messaging Pipeline

Campaigns and automations never call the gateway directly. They enqueue jobs:

```
enqueue → BullMQ (Redis) → messaging-worker → 7 pre-flight checks → messaging-gateway.routeMessage() → WAHA | Baileys
```

The worker runs **seven independent pre-flight checks**, each mapping a failure to a precise, non-retryable status so analytics stay honest:

1. **Tenant queue paused** — quota-exhausted or suspended tenants short-circuit.
2. **Staff guard** — `isStaff` customers (owners/staff) never receive marketing or automated messages.
3. **Hard suppression** — post opt-out (`isSuppressed`) → `CONSENT_REVOKED`.
4. **Channel consent** — promotional messages require the matching consent flag → `CONSENT_REVOKED`. Transactional messages (OTP, receipts, confirmations) bypass this.
5. **Marketing pause** — `marketingPausedUntil`, set by the negative-sentiment worker → `DROPPED_COOLDOWN`.
6. **Cooldown window** — any promotional message within the tenant's `messageCooldownHours` (default 72h) → `DROPPED_COOLDOWN`. The check looks at `sentAt`, so queued-but-unsent messages don't falsely block the window.
7. **Monthly quota** — atomic Redis decrement on `tenant:msg_quota:{businessId}`; `0` → `DROPPED_QUOTA`; `-1` means unlimited (Enterprise). The slot is **re-credited** if the send subsequently fails, so a network error never silently burns quota.

Direct, non-campaign sends from the inbox bypass BullMQ and call the gateway directly. `routeMessage()` is the single gateway entry point: it resolves the per-business provider and credentials, or — when `WHATSAPP_PROVIDER=baileys` — fast-paths every tenant through the in-process Baileys socket. Inbound WAHA webhooks arrive at `POST /api/webhooks/waha/:businessId` (outside `tenantScope`), where the `:businessId` matches the stored session id.

---

## 8. Scheduled Jobs (Cron)

Registered once at startup via `node-cron` (all UTC):

| Schedule | Job | Purpose |
|----------|-----|---------|
| `00:30` | **birthday** | Credit birthday bonus points (idempotent per year) + run birthday automations |
| `01:00` | **segmentRefresh** | Re-evaluate all customer segments (BIG_SPENDER before LOST/AT_RISK) |
| `01:05` | **analyticsSnapshot** | Pre-compute nightly KPIs per business/branch |
| `01:15` | **inactivityQueue** | Cursor-paginated win-back automations for inactive customers |
| `02:00` | **tierDemotion** | Demote inactive customers to keep tiers meaningful |
| `02:30` | **pointsExpiry** | Expire points older than `pointsExpiryDays` |
| `hourly` | **feedbackDispatch** | Send post-visit NPS quick-replies |
| `every 5 min` | **whatsappHealth** | Health-check sessions; drive warmup ramp + failover |

Cron can be disabled with `DISABLE_CRON=true` (useful when running multiple instances so only one schedules jobs).

---

## 9. Email Subsystem

Transactional email (password resets, staff invites, quota/billing alerts) is sent by `src/utils/email.util.ts`. It is **zero-dependency by default** — it sends over HTTPS using the global `fetch` — and auto-detects the active provider from the environment, in priority order:

1. `RESEND_API_KEY` → **Resend**
2. `SENDGRID_API_KEY` → **SendGrid**
3. `SMTP_HOST` (+ creds) → **SMTP** via nodemailer (optional dependency)
4. none → development logs to console; production warns and skips

A failed send is caught and logged — it **never crashes the calling flow** (auth, billing, etc.). Outgoing mail is wrapped in branded HTML. Set `EMAIL_FROM` (required) and `EMAIL_FROM_NAME` (optional) to go live; defaults are `no-reply@theloyaly.com` / "The Loyaly".

---

## 10. Billing & Subscriptions

Stripe drives five tiers, each with a monthly message quota mirrored into Redis for fast enforcement:

| Tier | Monthly Message Quota |
|------|----------------------|
| FREE | 500 |
| STARTER | 2,500 |
| GROWTH | 10,000 |
| PROFESSIONAL | 50,000 |
| ENTERPRISE | Unlimited (`-1`) |

Price IDs (monthly + annual per tier) are supplied via env vars and mapped to tiers. The Stripe webhook (`/api/stripe`, mounted with a raw-body parser **before** the JSON parser so signatures verify) handles `invoice.paid` (quota reset + tier sync), subscription changes, and downgrades-to-FREE on cancellation. Tenants reach the billing portal and checkout through the `/api/billing` router. Quota state lives at `tenant:msg_quota:{businessId}` and is decremented atomically per send.

---

## 11. Complete API Reference

All tenant routes sit behind `tenantScope`; `/health` and inbound webhooks do not. Base path `/api`.

### Auth (`/api/auth`)
`POST /register` · `POST /login` · `POST /refresh` · `POST /forgot-password` · `POST /reset-password` · `POST /accept-invite` · `POST /logout` · `GET /me` · `PUT /me` · `POST /invite` · `POST /staff` · `GET /staff` · `DELETE /staff/:userId` · `DELETE /account` · `POST /impersonate/:businessId` · `GET /google` · `GET /google/callback` · `GET/POST /apple[/callback]`. Login/register/refresh/forgot/invite are rate-limited.

### Loyalty (`/api/loyalty`)
`GET /:customerId/profile` · `GET /:customerId/referrals` · `GET /analytics/snapshot` · `GET /tiers` · `PUT /tiers` · `POST /:customerId/redeem` · `POST /checkin` · `POST /referral/apply` · `GET /dashboard` · `GET /customers` · `POST /customers` · `PATCH /customers/:customerId` · `DELETE /customers/:customerId` · `POST /customers/purge` · `GET /messages`.

### Campaigns (`/api/campaigns`)
`GET /` · `POST /` · `GET /:id` · `GET /:id/stats` · `PUT /:id` · `POST /:id/launch` · `POST /:id/schedule` · `POST /:id/pause` · `POST /:id/clone` · `POST /preview-payload`.

### Billing (`/api/billing`) & Stripe (`/api/stripe`)
`GET /` · `GET /features/:feature` · `POST /checkout` · `POST /portal` · Stripe webhook `POST /`.

### Automations (`/api/automations`)
`POST /preview` · `GET /` · `POST /` · `GET /:id` · `PUT /:id` · `DELETE /:id` · `POST /:id/activate` · `POST /:id/pause` · `POST /:id/trigger/:customerId` · `GET /:id/runs`.

### POS (`/api/pos`)
`GET /stats` · `GET /sales` · `GET /sale/:id` · `POST /sale` · `POST /sale/:id/fbr-retry` · `GET /receipt/:id` · `GET /wallet-lookup` · `POST /wallet-redeem`.

### WhatsApp (`/api/whatsapp`)
`GET /status` · `GET /qr` · `POST /session/start` · `POST /session/stop` · `PATCH /config`.

### Messages / Inbox (`/api/messages`)
`POST /send` · `GET /inbox` · `GET /inbox/:chatId` · `POST /broadcast` · `GET /`.

### Customer Portal (`/api/portal`)
`GET /:slug/info` · `POST /:slug/login` · `POST /:slug/verify-otp` · `GET /:slug/today` · `PATCH /:slug/settings` · `PATCH /:slug/location` · `GET /me` · `POST /redeem` · `POST /checkin`.

### AI BI (`/api/ai`)
`POST /query` · `GET /manifest` · `POST /generate-message`.

### Import (`/api/import`)
`POST /preview-headers` · `POST /customers`.

### POS Webhooks (`/api/webhooks/pos`) & WAHA (`/api/webhooks/waha`)
`POST /:provider` · `POST /` · `GET /config`; inbound WAHA at `/:businessId`.

### Website CMS (`/api/website`)
Public: `GET /public` · `GET/POST /reviews` · `GET /partners` · `GET /blog` · `GET /faq` · `POST /analytics/track`. Admin (operator-guarded): full CRUD over settings, sections, features, pricing, testimonials, partners, reviews, blog, FAQ, banners, plus analytics.

### Upload (`/api/upload`) & Super-Admin (`/api/admin`)
Menu/media upload; operator console endpoints.

---

## 12. Security Model

- **Authentication:** JWT access + refresh; refresh tokens are Argon2id-hashed and stored per device in `UserSession`. A Redis blacklist enables instant revocation on logout/role change.
- **Authorization:** `requireRoles(...)` after `tenantScope`; tenant context is derived from the verified token, never from the request body.
- **Password hashing:** Argon2id for users; coupon cashier PINs are Argon2id-hashed too — never plaintext.
- **Transport & headers:** Helmet with a scoped Content-Security-Policy; HTTPS throughout; `trust proxy` set to one hop so rate limiting buckets on the real client IP.
- **CORS:** explicit allow-list plus platform-domain matching (`*.railway.app`, `theloyaly.com/.online`); non-browser callers (Stripe, WAHA, curl) allowed.
- **Rate limiting:** `express-rate-limit` (Redis-backed) on auth-sensitive routes.
- **Webhook integrity:** Stripe signatures verified against the raw body; outbound webhooks HMAC-SHA256 signed.
- **Secrets hygiene:** presence-only logging of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `REDIS_URL` at boot — values never printed. Sensitive provider tokens (Meta, FBR) are stored encrypted at rest.
- **Audit & consent:** immutable `AuditLog` and `ConsentChangeLog` for every sensitive action and opt-in/opt-out.

---

## 13. Build & Local Development

### Quick start
```bash
bash start.sh        # one-shot: install, generate, push schema, seed, run everything
```

### Commands
```bash
npm run dev:all      # API :4000 + Vite :3000 + WAHA :3001 (concurrently)
npm run dev          # API only
npm run dev:no-waha  # API + Vite, skip WAHA for faster boot
npm run client:dev   # frontend only
npm run typecheck    # tsc --noEmit
npm run build        # tsc + client build (production artifacts)
npm run db:migrate:dev   # create + apply a migration
npm run db:migrate       # apply migrations (production)
npm run db:generate      # regenerate Prisma client after schema change
npm run db:studio        # Prisma Studio GUI
npm run db:seed          # seed demo tenant + accounts
```

### Demo accounts (after `db:seed`)
| Role | Email | Password |
|------|-------|----------|
| Platform Admin | `admin@cuberetain.com` | `Admin@123!` |
| Tenant Owner | `owner@coffeehouse.com` | `Owner@123!` |

### Ports
| Port | Service |
|------|---------|
| 4000 | Express backend API |
| 3000 | Vite dev server (React frontend) |
| 3001 | WAHA WhatsApp HTTP API |

### Connecting WhatsApp (WAHA, dev)
Log in as the owner → **Settings → WhatsApp** → scan the QR with **WhatsApp → Linked Devices → Link a Device**. The banner turns green and the session persists across restarts. WAHA Core (free) supports exactly one session named `default`; `WAHA_API_KEY` is the API password, not the session name.

---

## 14. Production Deployment

Loyable deploys to **Railway** from a Dockerfile. Railway watches the `main` branch — a push to `main` triggers a build and redeploy.

### Dockerfile — 3 stages
1. **client-builder** — `npm install` + `npm run build` produces `client/dist`.
2. **api-builder** — installs all deps, runs `prisma generate` (using the local Prisma v5 binary, never `npx`, to avoid pulling v7), then `tsc` to `dist/`.
3. **runner** — `node:20-alpine` with OpenSSL, production-only deps, the compiled `dist/`, the generated `.prisma` client, and `client/dist`. Starts with `node dist/app.js`.

The Prisma generator targets both `native` (dev) and `linux-musl-openssl-3.0.x` (Alpine runner) so the query engine matches the container.

### railway.json
```json
{
  "build":  { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "node dist/app.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

The single Node process serves **both** the API (`/api/*`) and the built SPA (everything else falls through to `index.html`). Migrations are applied out-of-band; additive schema changes also self-heal at boot via the idempotent `ensureSchemaPatches()` routine, so the app stays up even if `prisma db push` hasn't run yet. Health checks hit `/health`, which always responds because infrastructure init is best-effort and never blocks the port from binding.

**Deploy flow:** merge the feature branch into `main` and push. If Railway's webhook doesn't fire (e.g. after long inactivity), trigger a manual redeploy from the Railway dashboard (Deployments → Deploy) or `railway up`.

---

## 15. Environment Variables

```env
# ── Server ──────────────────────────────────────────────
PORT=4000
NODE_ENV=production
API_BASE_URL=https://your-app.railway.app   # used for WAHA webhook registration
FRONTEND_URL=https://theloyaly.com
CORS_ORIGINS=https://theloyaly.com,https://app.theloyaly.com
DISABLE_CRON=false                            # true on non-scheduler instances

# ── Database & Cache ────────────────────────────────────
DATABASE_URL=postgresql://...                 # Neon (pooled)
REDIS_URL=rediss://...                         # Upstash (TLS)

# ── Auth ────────────────────────────────────────────────
JWT_SECRET=...                                 # openssl rand -base64 64
JWT_REFRESH_SECRET=...

# ── WhatsApp ────────────────────────────────────────────
WHATSAPP_PROVIDER=baileys                       # or unset to use per-tenant WAHA
WAHA_BASE_URL=http://localhost:3001
WAHA_API_KEY=loyable
META_APP_SECRET=...                             # if using Meta Cloud API
META_WEBHOOK_VERIFY_TOKEN=...

# ── Payments ────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_FREE_M / STARTER_M / STARTER_A / GROWTH_M / GROWTH_A / PROFESSIONAL_M / PROFESSIONAL_A / ENTERPRISE_M / ENTERPRISE_A=price_...

# ── AI ──────────────────────────────────────────────────
OPENAI_API_KEY=sk-...

# ── Email (set ONE provider) ────────────────────────────
RESEND_API_KEY=...           # OR
SENDGRID_API_KEY=...         # OR  SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS
EMAIL_FROM=hello@theloyaly.com
EMAIL_FROM_NAME=The Loyaly

# ── Media (Cloudflare R2) ───────────────────────────────
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_URL=...

# ── Monitoring (optional) ───────────────────────────────
SENTRY_DSN=...
```

The four secrets the app refuses to be healthy without are `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, and `REDIS_URL` — their presence is logged at boot.

---

## 16. Load Testing

A multi-tenant load + isolation harness lives at `scripts/load-test.ts`. It seeds many tenants each with many customers, measures insert throughput and tenant-scoped query latency, and **verifies tenant isolation** — a query scoped to tenant A never returns tenant B's rows, and scoped writes never touch other tenants.

```bash
# ~1,000,000 customers across 20 tenants (default)
DATABASE_URL=postgres://… BUSINESSES=20 CUSTOMERS_PER_BIZ=50000 npx ts-node scripts/load-test.ts

# smaller smoke run
BUSINESSES=5 CUSTOMERS_PER_BIZ=2000 npx ts-node scripts/load-test.ts

# keep seeded data for manual EXPLAIN inspection
KEEP=1 … npx ts-node scripts/load-test.ts
```

**Verified result at 1,000,000 customers / 20 tenants** (local Postgres 16): bulk insert ≈ 6,300 rows/s; tenant-scoped list/lookup/aggregate queries stay within interactive latency; **isolation PASSED** (Σ per-tenant counts = global count; zero cross-tenant writes). The takeaway was baked back into the schema: segment-filtered list views need the `(businessId, segment, lastVisitAt)` covering index to avoid sequential scans on large tenants.

---

## 17. Changelog — What Has Been Shipped

**Loyalty & commerce**
- Points now genuinely accrue on every POS sale (`POST /api/pos/sale` calls `accruePointsForVisit` and returns `pointsEarned`).
- POS wallet payment: customers pay with points, bill adjusts automatically (`redeemRate`, `minRedeemPoints`).
- Birthday bonus points: configurable in Settings and actually awarded — idempotent, once per customer per year via a ledger reference key.
- Points expiry and tier demotion run nightly.

**Messaging & reliability**
- BullMQ Redis connection hardened with TLS + keep-alive to stop Upstash `ECONNRESET`.
- libsignal session-lifecycle console noise silenced in Baileys logs.
- Seven pre-flight checks with precise drop statuses; quota slots re-credited on send failure.

**Frontend & website**
- Full Loyalty & Rewards UI (tier sliders, points settings) moved into Settings → Loyalty Program.
- Customer portal fixed: tab bar always renders; Wi-Fi/announcements show only after login.
- Marketing features section redesigned responsive (laptop + phone) and CDN-independent; "Built-in POS" feature added.
- Tailwind migrated from the Play CDN to a compiled PostCSS build (`client/dist/assets/index-*.css`).

**Data integrity**
- Phone numbers normalise to E.164 (+44 default) across POS, portal login, and matching — one customer no longer splits into duplicates.
- Business logo + currency configurable and used consistently on receipts, POS, and dashboard.
- Fixed revenue-attribution queries referencing a non-existent column, CSV birthday regex comparison, and broken queue/automation imports.

**Build & types**
- Resolved pre-existing TypeScript errors (missing `EyeOff` import, wrong search param, stray context prop) and a JSX brace bug that broke the esbuild build.
- Added the `redeemRate` / `minRedeemPoints` migration.

**Scale**
- Verified at 1,000,000 customers across 20 tenants; added the `(businessId, segment, lastVisitAt)` covering index.

---

## 18. Roadmap

Planned, prioritised by revenue impact × retention × effort:

- **Soft quota warnings** — amber banner + email at 80%, red banner + upsell at 95%, instead of silent drops.
- **Revenue attribution engine** — surface "this campaign drove £X from Y customers" using the existing `attributedCampaignId` plumbing.
- **A/B testing** for campaigns with deterministic audience splitting and auto-winner selection.
- **Real-time WebSocket layer** for live delivery/read status and inbound messages.
- **No-code custom segment builder** (AND/OR rules over spend, visits, tier, points, recency).
- **NPS-driven automations** — wire the `FeedbackResponse` capture into the `SENTIMENT_NEGATIVE` trigger.
- **Cohort retention analysis** and a **churn-risk score** (0–100) per customer.
- **Integration marketplace** (Shopify, Square, WooCommerce, Google Sheets).
- **Per-tenant timezone** correctness for all scheduled dispatch.
- **2FA (TOTP)** for tenant owners, and a **circuit breaker** that pauses a tenant's queue after consecutive gateway failures.

---

## 19. Troubleshooting

| Problem | Fix |
|---------|-----|
| `EADDRINUSE: port 4000` | `fuser -k 4000/tcp` |
| Railway didn't redeploy after push | Trigger manually: Railway → Deployments → Deploy, or `railway up` |
| WAHA `422 only 'default' session supported` | Use `default` as the session name (WAHA Core free-tier limit) |
| `client/dist` missing in production | Ensure the Docker `client-builder` stage ran (`npm run client:build`) |
| Upstash `ECONNRESET` on queue | Confirm `REDIS_URL` uses `rediss://` (TLS); connection now sets keep-alive |
| Emails not sending | Set `RESEND_API_KEY` or `SENDGRID_API_KEY` **and** `EMAIL_FROM` |
| Prisma engine mismatch on Alpine | Schema targets `linux-musl-openssl-3.0.x`; rebuild the image |
| Two instances double-scheduling cron | Set `DISABLE_CRON=true` on all but one instance |
| Customer appears twice | Ensure phone numbers are E.164; matching normalises `07…`, `+44…`, `0044…` to one record |
| Platform admin sees tenant login | `localStorage.clear()` in the browser console, then hard refresh |

---

*Loyable — turning WhatsApp into the retention engine for the businesses your customers already message.*
