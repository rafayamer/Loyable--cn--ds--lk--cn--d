# ================================================================
#  .env.example — Cube Retain CRM API
#  Copy to .env and fill in your values.
#  Never commit .env to version control.
# ================================================================

# ── Server ────────────────────────────────────────────────────────
PORT=4000
NODE_ENV=development
API_BASE_URL=http://localhost:4000
API_DOMAIN=api.cuberetain.com
FRONTEND_URL=http://localhost:3000
DISABLE_CRON=false

# ── PostgreSQL ────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:changeme@localhost:5432/cube_retain
POSTGRES_PASSWORD=changeme

# ── Redis ─────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── JWT Auth ──────────────────────────────────────────────────────
# Generate with: openssl rand -base64 64
JWT_SECRET=replace-with-64-char-random-string-openssl-rand-base64-64
JWT_REFRESH_SECRET=replace-with-different-64-char-random-string

# ── Stripe ────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (create in Stripe Dashboard → Products)
STRIPE_PRICE_FREE_M=price_free_monthly
STRIPE_PRICE_STARTER_M=price_starter_monthly
STRIPE_PRICE_STARTER_A=price_starter_annual
STRIPE_PRICE_GROWTH_M=price_growth_monthly
STRIPE_PRICE_GROWTH_A=price_growth_annual
STRIPE_PRICE_PROFESSIONAL_M=price_professional_monthly
STRIPE_PRICE_PROFESSIONAL_A=price_professional_annual
STRIPE_PRICE_ENTERPRISE_M=price_enterprise_monthly
STRIPE_PRICE_ENTERPRISE_A=price_enterprise_annual

# ── Meta WhatsApp Cloud API ───────────────────────────────────────
META_APP_SECRET=your-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=your-custom-webhook-verify-token

# ── WAHA (Self-hosted WhatsApp) ───────────────────────────────────
# Optional — only needed for tenants using WAHA provider
# WAHA_DEFAULT_BASE_URL=https://waha.your-server.com
# WAHA_DEFAULT_API_KEY=your-waha-api-key

# ── OpenAI (Phase 7 — AI BI Controller) ──────────────────────────
OPENAI_API_KEY=sk-...

# ── Email ─────────────────────────────────────────────────────────
# Uncomment your provider and fill in credentials
# SendGrid:
SENDGRID_API_KEY=SG...
EMAIL_FROM=noreply@cuberetain.com
EMAIL_FROM_NAME=Cube Retain CRM

# ── Cloudflare R2 Storage (media uploads) ────────────────────────
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=cube-retain-media
R2_PUBLIC_URL=https://media.cuberetain.com

# ── Sentry (error monitoring) ─────────────────────────────────────
SENTRY_DSN=https://...@sentry.io/...

# ── Security ─────────────────────────────────────────────────────
CORS_ORIGIN=http://localhost:3000,https://app.cuberetain.com
