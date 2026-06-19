#!/usr/bin/env bash
# ================================================================
#  start.sh — Loyable CRM full startup script
#  Run this every time you open a fresh Codespace or terminal.
# ================================================================
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           Loyable CRM — Startup Script           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Kill any leftover processes ──────────────────────────────
echo "▶ Step 1: Stopping any running processes..."
pkill -f "ts-node-dev" 2>/dev/null && echo "  Killed ts-node-dev" || echo "  No ts-node-dev running"
pkill -f "vite"        2>/dev/null && echo "  Killed vite"        || echo "  No vite running"
pkill -f "nest"        2>/dev/null && echo "  Killed nest (WAHA)" || echo "  No nest running"
fuser -k 4000/tcp 2>/dev/null && echo "  Freed port 4000" || echo "  Port 4000 clear"
fuser -k 3000/tcp 2>/dev/null && echo "  Freed port 3000" || echo "  Port 3000 clear"
fuser -k 3001/tcp 2>/dev/null && echo "  Freed port 3001" || echo "  Port 3001 clear"
sleep 1

# ── 2. Pull latest code ─────────────────────────────────────────
echo ""
echo "▶ Step 2: Pulling latest changes from GitHub..."
git pull origin claude/compassionate-hypatia-u0x3x0

# ── 3. Install dependencies ─────────────────────────────────────
echo ""
echo "▶ Step 3: Installing dependencies..."
npm install --legacy-peer-deps
npm run client:install

# ── 4. Generate Prisma client ────────────────────────────────────
echo ""
echo "▶ Step 4: Generating Prisma client..."
npx prisma generate

# ── 5. Apply schema to database ─────────────────────────────────
echo ""
echo "▶ Step 5: Applying schema changes to database..."
npx prisma db push --accept-data-loss || echo "  ⚠ DB push failed — will retry at runtime"

# ── 6. Seed demo data ────────────────────────────────────────────
echo ""
echo "▶ Step 6: Seeding demo data (tenant + users + WAHA config)..."
npm run db:seed || echo "  ⚠ Seed failed — run manually: npm run db:seed"

# ── 7. Launch all services ───────────────────────────────────────
echo ""
echo "▶ Step 7: Starting all services..."
echo ""
echo "  • Backend API  → port 4000"
echo "  • Frontend     → port 3000"
echo "  • WAHA         → port 3001  (skip with Ctrl+C then: npm run dev:no-waha)"
echo ""
echo "══════════════════════════════════════════════════════"
echo "  After startup, open Settings → WhatsApp API tab"
echo "  and scan the QR code to connect WhatsApp."
echo "══════════════════════════════════════════════════════"
echo ""
npm run dev:all
