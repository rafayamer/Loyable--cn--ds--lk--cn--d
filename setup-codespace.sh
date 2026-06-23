#!/bin/bash
# Quick setup script for GitHub Codespaces
# Run: chmod +x setup-codespace.sh && ./setup-codespace.sh

set -e

echo "=== Loyable CRM — Codespace Setup ==="

# 1. Install dependencies
echo ""
echo "→ Installing npm packages..."
npm install --legacy-peer-deps

# 2. Generate Prisma client
echo ""
echo "→ Generating Prisma client..."
npx prisma generate

# 3. Check .env exists
if [ ! -f ".env" ]; then
  echo ""
  echo "⚠️  No .env file found!"
  echo "   Create one from .env.example:"
  echo "   cp .env.example .env"
  echo "   Then fill in your DATABASE_URL and REDIS_URL"
  exit 1
fi

# 4. Run migrations
echo ""
echo "→ Running database migrations..."
npx prisma migrate deploy

echo ""
echo "✅ Setup complete! Start the server with:"
echo "   npm run dev"
echo ""
echo "   API will be available at http://localhost:4000"
echo "   Health check: http://localhost:4000/health"
