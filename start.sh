#!/usr/bin/env bash
# ================================================================
#  start.sh — Loyable CRM full startup script
#  Run:  bash start.sh
#  Every time you open a fresh Codespace or terminal.
# ================================================================
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           Loyable CRM — Startup Script           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Kill any leftover processes ─────────────────────────
echo "▶ [1/8] Stopping any running processes..."

pkill -f "ts-node-dev" 2>/dev/null && echo "  ✓ Killed ts-node-dev"   || true
pkill -f "vite"        2>/dev/null && echo "  ✓ Killed vite"          || true
pkill -f "nest"        2>/dev/null && echo "  ✓ Killed WAHA (nest)"   || true

# Free ports without crashing the Codespace
fuser -k 4000/tcp 2>/dev/null && echo "  ✓ Freed port 4000" || echo "  ✓ Port 4000 clear"
fuser -k 3000/tcp 2>/dev/null && echo "  ✓ Freed port 3000" || echo "  ✓ Port 3000 clear"
fuser -k 3001/tcp 2>/dev/null && echo "  ✓ Freed port 3001" || echo "  ✓ Port 3001 clear"

sleep 1
echo ""

# ── Step 1b: Write waha/.env if missing ─────────────────────────
if [ ! -f waha/.env ]; then
  echo "  Writing waha/.env (auto-start default session)..."
  cat > waha/.env <<'WAHAENV'
WAHA_API_KEY=loyable
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=loyable
WHATSAPP_SWAGGER_USERNAME=admin
WHATSAPP_SWAGGER_PASSWORD=loyable
WHATSAPP_DEFAULT_ENGINE=NOWEB
WAHA_LOG_FORMAT=PRETTY
WAHA_LOG_LEVEL=info
WAHA_PRINT_QR=True
WAHA_MEDIA_STORAGE=LOCAL
WHATSAPP_FILES_FOLDER=./.sessions/media
WAHA_BASE_URL=http://localhost:3001
WHATSAPP_START_SESSION=default
WHATSAPP_RESTART_ALL_SESSIONS=True
WAHAENV
  echo "  ✓ waha/.env created"
fi
echo ""

# ── Step 2: Pull latest code ─────────────────────────────────────
echo "▶ [2/8] Pulling latest changes..."
git pull origin claude/compassionate-hypatia-u0x3x0 || {
  echo "  ⚠ Pull failed — removing lock files and retrying..."
  rm -f package-lock.json client/package-lock.json
  git pull origin claude/compassionate-hypatia-u0x3x0
}
echo ""

# ── Step 3: Install dependencies ─────────────────────────────────
echo "▶ [3/8] Installing backend dependencies..."
npm install --legacy-peer-deps --silent
echo ""
echo "▶ [3/8] Installing frontend dependencies..."
npm run client:install -- --silent
echo ""

# ── Step 4: Generate Prisma client ───────────────────────────────
echo "▶ [4/8] Generating Prisma client..."
npx prisma generate
echo ""

# ── Step 5: Apply schema to database ─────────────────────────────
echo "▶ [5/8] Applying schema to database..."
npx prisma db push --accept-data-loss && echo "  ✓ Schema up to date" || echo "  ⚠ db push failed — server will use existing schema"
echo ""

# ── Step 6: Seed demo data ────────────────────────────────────────
echo "▶ [6/8] Seeding demo accounts + loyalty config..."
npm run db:seed && echo "  ✓ Seed complete" || echo "  ⚠ Seed failed — run: npm run db:seed"
echo ""

# ── Step 7: Fix WAHA session ID in database ──────────────────────
echo "▶ [7/8] Ensuring wahaSessionId = 'default' in database..."
npm run db:fix-waha && echo "  ✓ WAHA config updated" || echo "  ⚠ WAHA fix failed — run: npm run db:fix-waha"
echo ""

# ── Step 8: Launch everything ─────────────────────────────────────
echo "▶ [8/8] Starting all services..."
echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  Service        Port   URL                          │"
echo "│  ─────────────────────────────────────────────────  │"
echo "│  Backend API    4000   /api/*                       │"
echo "│  Frontend       3000   React CRM                    │"
echo "│  WAHA           3001   WhatsApp API (auto-connects) │"
echo "└─────────────────────────────────────────────────────┘"
echo ""
echo "  Login: owner@coffeehouse.com / Owner@123!"
echo "  After startup → Settings → WhatsApp API → scan QR"
echo ""
echo "  Tip: use  npm run dev:no-waha  to skip WAHA"
echo "══════════════════════════════════════════════════════"
echo ""

npm run dev:all
