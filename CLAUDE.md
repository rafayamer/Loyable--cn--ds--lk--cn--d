# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Philosophy

**Loyable** is a WhatsApp-first customer retention SaaS for SMBs. Tenants are non-technical business owners. From their perspective, the product is: scan a QR code to connect WhatsApp, send messages, see what's being sent. Never expose WAHA internals, session IDs, base URLs, or any infrastructure concept to tenants. All technical complexity is owned by the SaaS operator.

## Commands

```bash
# Development (runs API on :4000, Vite on :3000, WAHA on :3001)
npm run dev:all

# API only
npm run dev

# Frontend only
npm run client:dev

# Type-check
npm run typecheck

# Build for production
npm run build

# Database
npm run db:migrate:dev    # create + apply migration
npm run db:migrate        # apply existing migrations (production)
npm run db:generate       # regenerate Prisma client after schema change
npm run db:studio         # Prisma Studio GUI
npm run db:seed           # seed test data
```

## Architecture

### Backend (`src/`)
Express on port 4000. Entry point is `src/app.ts` which bootstraps Redis, Prisma, then dynamically loads all routers. Routers that fail to load are skipped with a warning (no crash).

**Request lifecycle:** HTTP → `tenantScope` middleware → controller → service/gateway

**Multi-tenancy:** Every authenticated request goes through `src/middleware/tenant-scope-middleware.ts`. It verifies the JWT, checks Redis for token revocation, validates the `businessId`, and injects `req.tenantContext: { userId, businessId, branchLocationId, role, isImpersonating }`. Always access `businessId` from `req.tenantContext`, never from the request body.

**Roles:** `SUPER_ADMIN` > `TENANT_OWNER` > `BRANCH_MANAGER` > `MARKETING_STAFF`. Enforce with `requireRoles(Role.X, Role.Y)` after `tenantScope`.

### Messaging Pipeline
Campaigns and automations enqueue jobs via `src/services/messaging-queue.ts` → BullMQ → `src/services/messaging-worker.ts` runs 7 pre-flight checks (quota, consent, cooldown, suppression) → `src/services/messaging-gateway.ts` routes to WAHA.

`routeMessage()` in `messaging-gateway.ts` is the single gateway entry point. It looks up `wahaBaseUrl`, `wahaSessionId`, `wahaApiKey` from the `Business` record. The `WahaGateway` object handles all WAHA API calls.

Direct sends (not campaign/automation) bypass BullMQ and call `WahaGateway.sendText()` directly from `messages-controller.ts`.

### WhatsApp / WAHA
WAHA is a self-hosted WhatsApp HTTP API running on port 3001 (NOWEB engine). Each `Business` row stores its own `wahaBaseUrl`, `wahaSessionId`, `wahaApiKey`.

- `WahaGateway.startSession()` always deletes then recreates the session with `noweb.store.enabled=true` — required for `/chats/overview` to work
- `WahaGateway.getStatus()` maps both 404 (session not found) and connection errors to `'STOPPED'`
- Inbound webhooks arrive at `POST /api/webhooks/waha/:businessId` (not behind `tenantScope`). The `:businessId` param matches the `wahaSessionId` stored per tenant
- Opt-out keywords trigger `isSuppressed=true` + `consentChangeLog` entry + Redis cache invalidation

### Frontend (`client/src/`)
Single-page React app (Vite). All API calls go through `client/src/api/index.ts` which handles JWT attachment, 401 refresh, and error throwing. The entire app UI lives in `client/src/CRM.tsx`. `LoyableAdminPanel.tsx` is the super-admin panel.

### Key Prisma Models
- `Business` — one per tenant; holds WAHA config, Stripe subscription, quota
- `Customer` — scoped to `businessId`; has `whatsappNumber`, `marketingConsentWhatsapp`, `isSuppressed`, `marketingPausedUntil`
- `MessageQueue` — every outbound message (campaign, automation, direct send); FK requires `customerId` (non-nullable). Channel enum: `WHATSAPP_WAHA` | `WHATSAPP_META` | `EMAIL` | `SMS`
- `ConsentChangeLog` — audit trail for opt-in/opt-out events
- `Visit` — POS check-ins; drives loyalty points and segment evaluation

### Cron Jobs (`src/services/cron-service.ts`)
Nightly jobs: segment re-evaluation, birthday messages, win-back automations, analytics snapshots. Segments are evaluated per-customer based on recency + spend. Segment priority order matters — BIG_SPENDER must be evaluated before LOST/AT_RISK.

### Infrastructure
- **DB:** Neon (Postgres) via `DATABASE_URL`
- **Redis:** Upstash via `REDIS_URL` — used for JWT blacklist, tenant cache, BullMQ queue storage
- **Payments:** Stripe — webhooks at `/api/stripe`, billing portal via `stripe-service.ts`
- **WAHA:** Self-hosted Docker container; operator manages it, tenants only see "Connect WhatsApp"

### Environment Variables (required)
```
DATABASE_URL
REDIS_URL
JWT_SECRET
JWT_REFRESH_SECRET
API_BASE_URL          # public URL of the backend, used for WAHA webhook registration
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
OPENAI_API_KEY
```
