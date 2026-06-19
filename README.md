# Loyable CRM

WhatsApp-first retention OS for SMBs — loyalty + automation + campaigns + AI in one platform.

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

After the server is running:

1. Login as `owner@coffeehouse.com / Owner@123!`
2. Go to **Settings → WhatsApp API** tab
3. The page auto-detects WAHA status and shows a QR code when needed
4. Click **Connect** if status shows Disconnected
5. When the QR code appears:
   - Open WhatsApp on your phone
   - Go to **⋮ Menu → Linked Devices → Link a Device**
   - Scan the QR code
6. Status banner turns **green — Connected**

> **WAHA Core limitation:** Only one session named `default` is supported (free tier).
> WAHA Plus is required for multiple sessions / businesses.

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
