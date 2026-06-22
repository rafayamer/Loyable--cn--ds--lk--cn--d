#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Async so the session opens immediately while setup runs in background
echo '{"async": true, "asyncTimeout": 300000}'

cd "$CLAUDE_PROJECT_DIR"

echo "📦 Installing root dependencies..."
npm install --legacy-peer-deps --silent

echo "📦 Installing client dependencies..."
npm --prefix client install --legacy-peer-deps --silent

echo "🔄 Regenerating Prisma client..."
npm run db:generate --silent

echo "🚀 Starting dev servers (API :4000, WAHA :3001, Vite :3000)..."
npm run dev:all &

echo "✅ Loyable dev stack started."
