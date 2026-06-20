#!/usr/bin/env bash
# ============================================================
#  fresh-dev.sh
#  Kill any stale dev processes and start a clean full stack:
#    - backend API      (port 4000)
#    - WAHA WhatsApp API (port 3001)
#    - Vite client       (port 3000)
#
#  Usage:  npm run fresh      (preferred)
#     or:  bash scripts/fresh-dev.sh
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

echo "🧹  Clearing old dev processes…"

# 1) Kill anything listening on our dev ports.
for PORT in 4000 3001 3000; do
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "${PIDS}" ]; then
    echo "   • freeing port ${PORT} (pids: ${PIDS})"
    kill -9 ${PIDS} 2>/dev/null || true
  fi
done

# 2) Kill leftover dev runners by name (ts-node-dev, vite, waha, concurrently).
pkill -9 -f "ts-node-dev" 2>/dev/null || true
pkill -9 -f "vite"        2>/dev/null || true
pkill -9 -f "nest start"  2>/dev/null || true
pkill -9 -f "start:dev"   2>/dev/null || true
pkill -9 -f "concurrently" 2>/dev/null || true

# 3) Give the OS a moment to release the sockets.
sleep 1

echo "✅  Clean. Starting fresh dev session (backend + WAHA + client)…"
echo "------------------------------------------------------------"
exec npm run dev:all
