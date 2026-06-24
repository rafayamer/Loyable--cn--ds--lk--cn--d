import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { prisma } from './config/prisma';
import { initRedis } from './config/redis';
import { initRedis as initTenantRedis } from './middleware/tenant-scope-middleware';
import { wahaWebhookRouter } from './services/messaging-gateway';

// ── Crash visibility ──────────────────────────────────────────────
// Print the moment the process starts so we always see *something* in
// the platform logs, and never let an async crash die silently.
console.log('[app] Process starting. NODE_ENV=' + (process.env.NODE_ENV ?? 'undefined'));
process.on('unhandledRejection', (reason) => {
  console.error('[app] UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[app] UNCAUGHT EXCEPTION:', err);
});

const app = express();

/**
 * Self-healing schema patches for purely ADDITIVE changes.
 * Runs at startup with the app's own DB credentials so additive columns/indexes
 * are present even if `prisma db push` hasn't been run yet. Every statement is
 * idempotent (IF NOT EXISTS) and safe to run on every boot.
 */
async function ensureSchemaPatches() {
  const stmts: Array<{ label: string; sql: string }> = [
    { label: 'customers.isStaff',
      sql: 'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isStaff" BOOLEAN NOT NULL DEFAULT false' },
    { label: 'businesses.bigSpenderThreshold',
      sql: 'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "bigSpenderThreshold" INTEGER NOT NULL DEFAULT 500' },
    // Idempotency guard against points double-credit. Uses a partial-safe unique
    // index; if legacy duplicate rows exist this will warn but never crash boot.
    { label: 'reward_points_ledger uniq(customerId,reason,referenceId)',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "reward_points_ledger_customerId_reason_referenceId_key" ON "reward_points_ledger" ("customerId", "reason", "referenceId")' },
    // Clear stale WAHA URLs so the WAHA_BASE_URL env var takes effect. This
    // covers localhost (saved before the env var existed) and any persisted
    // value that no longer matches the configured env var (e.g. an old/dead
    // Railway public domain from a previous WAHA service).
    { label: 'businesses.wahaBaseUrl clear localhost',
      sql: `UPDATE "businesses" SET "wahaBaseUrl" = NULL WHERE "wahaBaseUrl" LIKE '%localhost%'` },
    ...(process.env.WAHA_BASE_URL && process.env.WAHA_BASE_URL.trim()
      ? [{ label: 'businesses.wahaBaseUrl clear stale (!= env)',
          sql: `UPDATE "businesses" SET "wahaBaseUrl" = NULL WHERE "wahaBaseUrl" IS NOT NULL AND "wahaBaseUrl" <> '${process.env.WAHA_BASE_URL.trim().replace(/'/g, "''")}'` }]
      : []),
  ];
  for (const { label, sql } of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn(`[app] schema patch "${label}" skipped:`, (e as Error).message);
    }
  }
  console.log('[app] schema patches ensured.');
}

async function bootstrap() {
  // Log which critical secrets are present (values never logged) so the
  // platform logs make missing-config obvious without crashing the boot.
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
    console.log(`[app] env ${k}: ${process.env[k] ? 'set' : 'MISSING'}`);
  }

  // Infrastructure init is best-effort. A Redis/DB hiccup must NOT prevent the
  // HTTP server from binding — otherwise the platform shows "Application failed
  // to respond" with no clue. We log failures and continue; /health still works.
  try {
    await initRedis();
    await initTenantRedis();
    console.log('[app] Redis initialised.');
  } catch (e) {
    console.error('[app] Redis init FAILED (continuing so port still binds):', (e as Error).message);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    await ensureSchemaPatches();
    console.log('[app] Database reachable, schema patches ensured.');
  } catch (e) {
    console.error('[app] Database init FAILED (continuing so port still binds):', (e as Error).message);
  }

  // Behind a load balancer (Neon/Render/etc) the real client IP arrives via
  // X-Forwarded-For. Without this, express.ip is the proxy IP and rate limiting
  // collapses into a single shared bucket. Trust the first proxy hop only.
  app.set('trust proxy', 1);

  // Content Security Policy. We still rely on the Tailwind CDN (which needs
  // 'unsafe-eval'/'unsafe-inline') so we scope a policy rather than disabling it
  // outright. Tighten further once Tailwind is compiled at build time.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-eval'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc:  ["'self'", 'https:', 'wss:'],
        objectSrc:   ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS — restrict to known origins. Set CORS_ORIGINS (comma-separated) or
  // FRONTEND_URL in production; falls back to localhost dev ports. The frontend
  // is also served by this same app, so requests from our own deploy domains
  // (Railway, and any configured custom domain) are always allowed.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:3000,http://localhost:3002')
    .split(',').map(o => o.trim()).filter(Boolean);
  if (process.env.API_BASE_URL) allowedOrigins.push(process.env.API_BASE_URL.trim());

  const isAllowedOrigin = (origin: string): boolean => {
    if (allowedOrigins.includes(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      // Our own platform domains — the SPA is served from the same origin as the API.
      if (host.endsWith('.railway.app')) return true;
      if (host.endsWith('theloyaly.com') || host.endsWith('theloyaly.online')) return true;
    } catch { /* malformed origin → reject below */ }
    return false;
  };

  app.use(cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (no Origin header: WAHA, Stripe, curl, mobile).
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
      // Don't throw (which surfaces as a 500). Just deny CORS headers.
      console.warn(`[app] CORS: origin not allowed: ${origin}`);
      return cb(null, false);
    },
    credentials: true,
  }));

  // ── Stripe webhook MUST receive the raw body for signature verification.
  // Mounted BEFORE express.json() so the global JSON parser does not consume
  // the stream. express.raw sets req._body=true, so express.json skips it.
  app.use('/api/stripe', express.raw({ type: '*/*' }));

  app.use(express.json({ limit: '10mb' }));

  // Minimal cookie parser — the auth refresh flow reads the httpOnly
  // `refresh_token` cookie from req.cookies. (Avoids a cookie-parser dep.)
  app.use((req: any, _res, next) => {
    const header = req.headers?.cookie;
    const jar: Record<string, string> = {};
    if (typeof header === 'string') {
      for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx > -1) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k) jar[k] = decodeURIComponent(v);
        }
      }
    }
    req.cookies = jar;
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── API Routes ────────────────────────────────────────────────
  const loadRouter = async (modulePath: string, exportName: string, mountAt: string) => {
    try {
      const mod = await import(modulePath);
      const router = mod[exportName];
      if (!router) throw new Error(`No export "${exportName}" in ${modulePath}`);
      app.use(mountAt, router);
      console.log(`[app] ✓ ${mountAt}`);
    } catch (e) {
      console.warn(`[app] ✗ ${mountAt} skipped:`, (e as Error).message);
    }
  };

  await loadRouter('./controllers/auth-controller',       'authRouter',        '/api/auth');
  await loadRouter('./controllers/loyalty-controller',    'loyaltyRouter',     '/api/loyalty');
  await loadRouter('./controllers/campaign-controller',   'campaignRouter',    '/api/campaigns');
  await loadRouter('./controllers/campaign-controller',   'billingRouter',     '/api/billing');
  await loadRouter('./controllers/campaign-controller',   'stripeWebhookRouter','/api/stripe');
  await loadRouter('./controllers/automation-controller', 'automationRouter',  '/api/automations');
  await loadRouter('./controllers/import-controller',     'importRouter',      '/api/import');
  await loadRouter('./controllers/webhook-pos',           'posWebhookRouter',  '/api/webhooks/pos');
  await loadRouter('./controllers/ai-bi-controller',      'aiBiRouter',        '/api/ai');
  await loadRouter('./controllers/pos-controller',        'posRouter',         '/api/pos');
  await loadRouter('./routes/super-admin',                'adminRouter',       '/api/admin');
  await loadRouter('./controllers/whatsapp-controller',  'whatsappRouter',    '/api/whatsapp');
  await loadRouter('./controllers/messages-controller',  'messagesRouter',    '/api/messages');
  await loadRouter('./controllers/oauth-controller',     'oauthRouter',       '/api/auth');
  await loadRouter('./controllers/website-cms-controller',    'websiteCmsRouter',      '/api/website');
  await loadRouter('./controllers/customer-portal-controller','customerPortalRouter',  '/api/portal');
  await loadRouter('./controllers/upload-controller',          'uploadRouter',          '/api/upload');

  // Serve uploaded files (menu images / PDFs)
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!require('fs').existsSync(uploadsDir)) require('fs').mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  // WAHA inbound webhook (not behind tenantScope — WAHA posts here directly)
  app.use('/api/webhooks/waha', wahaWebhookRouter);

  // ── Global error handler — catches unhandled async errors ─────
  app.use((err: any, _req: any, res: any, _next: any) => {
    const msg = err?.message ?? 'INTERNAL_ERROR';
    const status = err?.status ?? err?.statusCode ?? 500;
    console.error('[app] Unhandled error:', msg);
    if (!res.headersSent) res.status(status).json({ error: msg });
  });

  // ── Serve React frontend ──────────────────────────────────────
  const fs         = await import('fs');
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const isDev      = process.env.NODE_ENV !== 'production';

  if (!isDev && fs.existsSync(path.join(clientDist, 'index.html'))) {
    // Production: serve built static files
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  } else {
    // Development: redirect browser requests to Vite dev server on port 3000
    app.get('/', (_req, res) => res.redirect('http://localhost:3000'));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.redirect(`http://localhost:3000${req.path}`);
    });
  }

  const PORT = process.env.PORT ?? 4000;
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`[app] Running on http://0.0.0.0:${PORT}`));
}

bootstrap().catch((err) => {
  console.error('[app] Fatal:', err);
  process.exit(1);
});
