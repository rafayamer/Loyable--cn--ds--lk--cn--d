#!/usr/bin/env bash
# ============================================================
#  fresh-dev.sh
#  Kill stale processes, install all deps, and start dev stack:
#    - backend API       (port 4000)
#    - Vite client       (port 3000)
#    - WAHA WhatsApp API (port 3001)  — skipped if unavailable
#
#  Usage:  npm run fresh
#     or:  bash scripts/fresh-dev.sh
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

echo "🧹  Stopping old dev processes..."

for PORT in 4000 3001 3000; do
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "${PIDS}" ]; then
    echo "   • freeing port ${PORT} (pids: ${PIDS})"
    kill -9 ${PIDS} 2>/dev/null || true
  fi
done

pkill -9 -f "ts-node-dev"  2>/dev/null || true
pkill -9 -f "vite"         2>/dev/null || true
pkill -9 -f "nest start"   2>/dev/null || true
pkill -9 -f "start:dev"    2>/dev/null || true
pkill -9 -f "concurrently" 2>/dev/null || true

sleep 1

echo "📦  Installing root dependencies..."
npm install --legacy-peer-deps 2>&1 | tail -5

echo "📦  Installing client dependencies..."
npm --prefix client install --legacy-peer-deps 2>&1 | tail -5

echo "🔄  Regenerating Prisma client..."
npm run db:generate 2>&1 | tail -3

echo ""
echo "✅  All dependencies installed. Starting dev servers..."
echo "   → API:     http://localhost:4000"
echo "   → Client:  http://localhost:3000"
echo "------------------------------------------------------------"

# Try full stack (with WAHA); fall back to no-waha if waha dir missing or yarn not set up
if [ -f "waha/package.json" ] && command -v yarn &>/dev/null; then
  exec npm run dev:all
else
  echo "⚠️  WAHA not available — starting API + client only"
  exec npm run dev:no-waha
fi
