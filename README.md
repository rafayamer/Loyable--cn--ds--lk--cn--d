# Loyable CRM

WhatsApp-first retention OS for SMBs — loyalty + automation + campaigns + AI in one platform.

---

## Recent Improvements

- **Loyalty points now actually accrue on every POS sale.** `POST /api/pos/sale` previously created a Visit but never credited points; it now calls `accruePointsForVisit` and returns `pointsEarned` (shown in the POS UI after *Mark as Paid*).
- **Phone numbers normalise to E.164 (+44 default) everywhere** — POS, portal login, and customer matching — so a customer entered as `07…`, `+44…`, or `0044…` always resolves to the same record.
- **Business logo + currency are configurable** in *Settings → Business*; the logo prints on receipts and the currency is used consistently across POS, receipts, and dashboard.
- **Campaign Builder is fully functional** — it now saves a real campaign (`layoutJson`), lets you pick the audience segment/channel/schedule, and **Save & Launch** queues messages immediately. The campaigns list shows live sent/delivered/read stats.
- **Transactional email actually sends** via Resend, SendGrid, or SMTP (auto-detected from env) with branded HTML templates. See [Email Setup](#email-setup).
- **Marketing site upgraded** — 10 emotional customer success stories, scroll-reveal animations, clearer non-technical copy, and a working light/dark theme toggle.
- **Bug fixes:** revenue-attribution queries referenced a non-existent `automationId` column (now `automationRunId`); CSV birthday parsing compared regex objects by reference (always false); broken `automationTrigger`/queue imports in the loyalty controller.
- **Verified at 1,000,000 customers across 20 tenants** — see [Load Testing](#load-testing). Added a covering index `(businessId, segment, lastVisitAt)` so large tenants never fall back to a sequential scan.

---

## Quick Start (Codespace / Fresh Terminal)

Every time you open a new Codespace or terminal session, run the single startup script:

```bash
bash start.sh
```

This does everything automatically. See below if you need to run steps individually.

---

## Manual Steps (one by one)

### Step 1 — Stop any leftover processes

Previous sessions leave orphan processes on ports 3000, 3001, and 4000. Kill them first:

```bash
pkill -f "ts-node-dev" 2>/dev/null; pkill -f "vite" 2>/dev/null; pkill -f "nest" 2>/dev/null
fuser -k 4000/tcp 2>/dev/null; fuser -k 3000/tcp 2>/dev/null; fuser -k 3001/tcp 2>/dev/null
```

> **Note:** If `pkill` causes the Codespace to restart, that is normal — it only means the last server was the foreground process. Just wait for the Codespace to come back and continue.

---

### Step 2 — Pull latest code

```bash
git pull origin claude/compassionate-hypatia-u0x3x0
```

If you get a lock file conflict:

```bash
rm -f package-lock.json client/package-lock.json
git pull origin claude/compassionate-hypatia-u0x3x0
```

---

### Step 3 — Install dependencies

```bash
npm install --legacy-peer-deps
npm run client:install
```

---

### Step 4 — Generate Prisma client

Run this after any schema change (`prisma/schema.prisma`):

```bash
npx prisma generate
```

---

### Step 5 — Apply schema changes to database

```bash
npx prisma db push
```

This syncs the schema to Neon PostgreSQL. Run once after pulling new code that includes schema changes.

---

### Step 6 — Seed demo data

Sets up the demo tenant, users, and WAHA config in the database:

```bash
npm run db:seed
```

Demo accounts created:

| Role | Email | Password |
|------|-------|----------|
| Platform Admin | `admin@cuberetain.com` | `Admin@123!` |
| Tenant Owner | `owner@coffeehouse.com` | `Owner@123!` |

---

### Step 7 — Start everything

```bash
npm run dev:all
```

This starts three services concurrently:

| Service | Port | URL |
|---------|------|-----|
| Backend API (Express) | 4000 | `https://<codespace>-4000.app.github.dev` |
| Frontend (Vite/React) | 3000 | `https://<codespace>-3000.app.github.dev` |
| WAHA WhatsApp API | 3001 | `https://<codespace>-3001.app.github.dev` |

**Without WAHA** (faster startup, if you don't need WhatsApp right now):

```bash
npm run dev:no-waha
```

---

## Connecting WhatsApp (WAHA)

WAHA auto-starts the `default` session on launch (set via `WHATSAPP_START_SESSION=default` in `waha/.env`). You just need to scan the QR code once.

After `bash start.sh` completes:

1. Login as `owner@coffeehouse.com / Owner@123!`
2. Go to **Settings → WhatsApp API** tab
3. Status will show **"Scan QR code"** with a QR image
4. On your phone:
   - Open **WhatsApp**
   - Tap **⋮ (three dots) → Linked Devices → Link a Device**
   - Scan the QR code
5. Status banner turns **green — Connected**

WhatsApp stays connected until you log out or restart WAHA. On next `bash start.sh`, WAHA restores the saved session automatically — no re-scan needed.

> **NEVER create a session with any name other than `default`** — WAHA Core (free) only supports one session named exactly `default`. Trying to POST `/api/sessions` with name `loyable` or anything else will get a 422 error. The `WAHA_API_KEY=loyable` is just the _password_ to authenticate API calls, not the session name.

---

## Architecture

```
client/          React 18 + Vite frontend (TypeScript)
src/
  app.ts         Express bootstrap — mounts all routes
  controllers/   HTTP route handlers
  services/      Business logic (messaging, loyalty, campaigns, POS, FBR)
  middleware/     tenantScope (multi-tenant isolation), auth
  config/        Redis, env
prisma/
  schema.prisma  Database schema (PostgreSQL via Neon)
  seed.ts        Demo data seeder
waha/            WAHA Core (NestJS WhatsApp HTTP API, port 3001)
```

### Ports

| Port | Service |
|------|---------|
| 4000 | Express backend API |
| 3000 | Vite dev server (React frontend) |
| 3001 | WAHA WhatsApp HTTP API |

### Key API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login |
| GET | `/api/loyalty/stats` | Dashboard KPIs |
| GET | `/api/customers` | Customer list |
| GET | `/api/whatsapp/status` | WAHA session status |
| GET | `/api/whatsapp/qr` | QR code (base64 PNG) |
| POST | `/api/whatsapp/session/start` | Start WAHA session |
| POST | `/api/pos/sale` | Create POS sale (FBR e-invoice) |
| GET | `/api/pos/receipt/:id` | Printable receipt HTML |

---

## Environment Variables (`.env`)

```env
DATABASE_URL="postgresql://..."        # Neon PostgreSQL (pooler URL)
REDIS_URL="rediss://..."               # Upstash Redis TLS
JWT_SECRET="..."
JWT_REFRESH_SECRET="..."
PORT=4000
NODE_ENV=development
WAHA_BASE_URL="http://localhost:3001"
WAHA_API_KEY="loyable"
```

---

## Email Setup

Transactional email (password resets, staff invites, quota/billing alerts) is sent by
`src/utils/email.util.ts`. It auto-detects a provider from the environment — set **one**:

| Provider | Env vars | Notes |
|----------|----------|-------|
| **Resend** (recommended) | `RESEND_API_KEY`, `EMAIL_FROM` | Pure HTTPS, no extra deps |
| **SendGrid** | `SENDGRID_API_KEY`, `EMAIL_FROM` | Pure HTTPS, no extra deps |
| **SMTP** (Gmail, etc.) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Requires `npm i nodemailer` |

With no provider set, emails are logged to the console in development and skipped (with a
warning) in production — a failed send never crashes the calling flow. See `.env.example`.

---

## Load Testing

A multi-tenant load + isolation harness lives at `scripts/load-test.ts`. It seeds many
tenants each with many customers, then measures insert throughput and tenant-scoped query
latency, and **verifies tenant isolation** (a query scoped to tenant A never returns tenant
B's rows; scoped writes never touch other tenants).

```bash
# ~1,000,000 customers across 20 tenants (default)
DATABASE_URL=postgres://… BUSINESSES=20 CUSTOMERS_PER_BIZ=50000 npx ts-node scripts/load-test.ts

# smaller smoke run
BUSINESSES=5 CUSTOMERS_PER_BIZ=2000 npx ts-node scripts/load-test.ts

# keep the seeded data for manual EXPLAIN inspection
KEEP=1 … npx ts-node scripts/load-test.ts
```

Verified result at **1,000,000 customers / 20 tenants** (local Postgres 16): bulk insert
~6,300 rows/s; tenant-scoped list/lookup/aggregate queries stay well within interactive
latency; **isolation PASSED** (Σ per-tenant counts = global count; 0 cross-tenant writes).
Takeaway baked back into the schema: segment-filtered list views need the
`(businessId, segment, lastVisitAt)` covering index to avoid sequential scans on large tenants.

---

## Common Issues

| Problem | Fix |
|---------|-----|
| `EADDRINUSE: port 4000` | Run `fuser -k 4000/tcp` |
| `[tenantScope] Redis client not initialized` | Both Redis singletons must init — already fixed in `app.ts` |
| Platform Admin panel for tenant login | Run `localStorage.clear()` in browser console, hard refresh |
| Vite served on port 3001 instead of 3000 | Port 3000 taken — access `https://<codespace>-3001.app.github.dev` |
| WAHA 422 "only 'default' session supported" | Use `default` as session name (WAHA Core free tier limit) |
| `client/dist` missing | Run `npm run client:build` |
| DB unreachable from terminal | Normal in Codespace — DB is accessible from the running server, not CLI |
