// ================================================================
//  app.ts
//  Production Express application bootstrap.
//  Wires every phase of the platform into a single running server.
//
//  Mount order is intentional and must not be changed:
//    1. Stripe webhook (raw body — BEFORE express.json())
//    2. CORS + Helmet security headers
//    3. express.json()
//    4. Rate limiting (Redis-backed)
//    5. White-label domain middleware
//    6. Public routes (health, auth, POS webhooks)
//    7. Protected API routes
//    8. Super Admin routes (Platform Administrator only)
//    9. GDPR routes (tenant-scoped)
//   10. Global error handler
//
//  On startup:
//    - Database connectivity verified
//    - Redis connectivity verified
//    - BullMQ workers registered (3 workers)
//    - node-cron nightly jobs scheduled (4 jobs)
//    - Graceful SIGTERM / SIGINT shutdown registered
// ================================================================

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet       from 'helmet';
import cors         from 'cors';
import rateLimit    from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { PrismaClient }             from '@prisma/client';

// ── Phase 1 ──────────────────────────────────────────────────────
import { initRedis, getRedisClient }  from './config/redis';

// ── Phase 2 ──────────────────────────────────────────────────────
import { authRouter }                 from './controllers/auth.controller';

// ── Phase 3 ──────────────────────────────────────────────────────
import { startAllWorkers, gracefulShutdown } from './workers/messaging.worker';
import { metaWebhookRouter, wahaWebhookRouter } from './gateways/messaging.gateway';

// ── Phase 4 ──────────────────────────────────────────────────────
import { loyaltyRouter }              from './controllers/loyalty.controller';
import { startAllCronJobs }           from './services/cron.service';

// ── Phase 5 ──────────────────────────────────────────────────────
import { automationRouter }           from './controllers/automation.controller';

// ── Phase 6 ──────────────────────────────────────────────────────
import { campaignRouter, stripeWebhookRouter, billingRouter } from './controllers/campaign.controller';

// ── Phase 7 ──────────────────────────────────────────────────────
import { posWebhookRouter }           from './controllers/webhook.pos';
import { aiBiRouter }                 from './controllers/ai.bi';
import { importRouter }               from './controllers/import.controller';

// ── Phase 8 ──────────────────────────────────────────────────────
import { adminRouter }                from './controllers/super.admin.controller';
import { gdprRouter }                 from './controllers/gdpr.controller';

const prisma = new PrismaClient();
const app    = express();

// ================================================================
// WHITE-LABEL MIDDLEWARE
// ================================================================

/**
 * Intercepts the Host header and looks up the matching tenant.
 * Attaches brandingColors to req for use in API responses and
 * email template rendering.
 *
 * For custom domains (e.g. loyalty.coffeehouse.com):
 *  - Business table: customDomain = 'loyalty.coffeehouse.com'
 *  - brandingColors JSONB is attached to req.branding
 *  - The Next.js layout.tsx calls GET /api/public/branding?domain=...
 *    to get CSS variables for :root injection
 */
interface BrandingContext {
  businessId:    string;
  businessName:  string;
  primaryColor:  string;
  secondaryColor: string;
  accentColor:   string;
  logoUrl:       string | null;
}

declare global {
  namespace Express {
    interface Request {
      branding?: BrandingContext;
    }
  }
}

const whiteLabelMiddleware = async (
  req:  Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase();

    // Skip for localhost and the platform's own domain
    const ownDomain = (process.env.API_DOMAIN ?? 'api.cuberetain.com').toLowerCase();
    if (!host || host === 'localhost' || host === ownDomain || host.endsWith('.localhost')) {
      return next();
    }

    const business = await prisma.business.findFirst({
      where:  { customDomain: host, isActive: true },
      select: {
        id:            true,
        name:          true,
        logoUrl:       true,
        brandingColors: true,
      },
    });

    if (business?.brandingColors) {
      const c = business.brandingColors as Record<string, string>;
      req.branding = {
        businessId:    business.id,
        businessName:  business.name,
        primaryColor:  c.primary   ?? '#8b5cf6',
        secondaryColor: c.secondary ?? '#7c3aed',
        accentColor:   c.accent    ?? '#06b6d4',
        logoUrl:       business.logoUrl,
      };
    }
  } catch {
    // Non-fatal — proceed without branding
  }
  next();
};

// ================================================================
// PUBLIC BRANDING ENDPOINT (called by Next.js layout.tsx)
// ================================================================

/**
 * GET /api/public/branding?domain=loyalty.coffeehouse.com
 * Returns CSS custom properties for the :root pseudo-class.
 * No authentication required — public endpoint.
 */
const brandingHandler = async (req: Request, res: Response): Promise<void> => {
  const domain = (req.query.domain as string | undefined)?.toLowerCase().trim();

  if (!domain) {
    res.status(400).json({ error: 'domain query parameter is required' });
    return;
  }

  const business = await prisma.business.findFirst({
    where:  { customDomain: domain, isActive: true },
    select: { name: true, logoUrl: true, brandingColors: true },
  });

  if (!business) {
    // Return default Cube Retain branding
    res.status(200).json({
      domain,
      found: false,
      cssVariables: defaultCssVariables(),
    });
    return;
  }

  const c = (business.brandingColors ?? {}) as Record<string, string>;

  res.status(200).json({
    domain,
    found:        true,
    businessName: business.name,
    logoUrl:      business.logoUrl,
    cssVariables: {
      '--primary':          c.primary    ?? '#8b5cf6',
      '--secondary':        c.secondary  ?? '#7c3aed',
      '--accent':           c.accent     ?? '#06b6d4',
      '--background':       c.background ?? '#0a0615',
      '--foreground':       c.foreground ?? '#ffffff',
      '--card':             c.card       ?? 'rgba(30,30,45,0.8)',
      '--border':           c.border     ?? 'rgba(255,255,255,0.06)',
    },
  });
};

const defaultCssVariables = () => ({
  '--primary':    '#8b5cf6',
  '--secondary':  '#7c3aed',
  '--accent':     '#06b6d4',
  '--background': '#0a0615',
  '--foreground': '#ffffff',
  '--card':       'rgba(30,30,45,0.8)',
  '--border':     'rgba(255,255,255,0.06)',
});

// ================================================================
// GDPR ROUTER (Phase 8 — tenant-scoped self-service)
// ================================================================

// Inline GDPR router (or import from gdpr.controller.ts)
import { Router }               from 'express';
import { tenantScope, requireRoles } from './middleware/tenantScope';
import { Role }                 from '@prisma/client';
import { purgeCustomerData, exportCustomerData, updateConsent, getConsentHistory } from './services/gdpr.service';

const _gdprRouter = Router();
_gdprRouter.use(tenantScope as any);

// Customer requests their own data (Customer role)
_gdprRouter.get('/export/:customerId',
  requireRoles(Role.TENANT_OWNER, Role.CUSTOMER) as any,
  async (req, res) => {
    try {
      const data = await exportCustomerData(req.params.customerId, req.tenantContext.businessId);
      res.setHeader('Content-Disposition', `attachment; filename="my-data-${Date.now()}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'EXPORT_ERROR';
      res.status(msg === 'CUSTOMER_NOT_FOUND' ? 404 : 500).json({ error: msg });
    }
  }
);

// Customer requests erasure (Tenant Owner approves)
_gdprRouter.delete('/purge/:customerId',
  requireRoles(Role.TENANT_OWNER) as any,
  async (req, res) => {
    try {
      const result = await purgeCustomerData(
        req.params.customerId,
        req.tenantContext.businessId,
        req.tenantContext.userId
      );
      res.status(200).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PURGE_ERROR';
      res.status(msg === 'CUSTOMER_NOT_FOUND' ? 404 : 500).json({ error: msg });
    }
  }
);

// Consent update
_gdprRouter.patch('/consent/:customerId',
  async (req, res) => {
    try {
      await updateConsent(
        req.params.customerId,
        req.tenantContext.businessId,
        req.body,
        'CUSTOMER_REQUEST',
        req.ip
      );
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'CONSENT_UPDATE_ERROR' });
    }
  }
);

// Consent history
_gdprRouter.get('/consent/:customerId/history',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  async (req, res) => {
    const logs = await getConsentHistory(req.params.customerId, req.tenantContext.businessId);
    res.status(200).json(logs);
  }
);

// ================================================================
// RATE LIMITERS (Redis-backed, per IP)
// ================================================================

const buildRateLimiter = (windowMs: number, max: number, prefix: string) => {
  const redis = getRedisClient();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'RATE_LIMITED', retryAfter: Math.ceil(windowMs / 1000) },
    store: new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).sendCommand(args),
      prefix,
    }),
  });
};

// ================================================================
// EXPRESS APP ASSEMBLY
// ================================================================

export const buildApp = () => {
  // ── Security headers ─────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'"],   // Relax for dashboard JS
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://graph.facebook.com'],
        frameSrc:   ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for WhatsApp media previews
  }));

  // ── ① Stripe webhook BEFORE express.json() ───────────────────
  app.use('/api/webhooks/stripe', stripeWebhookRouter);

  // ── CORS ─────────────────────────────────────────────────────
  app.use(cors({
    origin: (origin, cb) => {
      const allowed = [
        process.env.FRONTEND_URL ?? 'http://localhost:3000',
        /\.cuberetain\.com$/,
      ];
      if (!origin) return cb(null, true); // Curl / server-to-server
      const isAllowed = allowed.some(a =>
        typeof a === 'string' ? a === origin : a.test(origin)
      );
      cb(isAllowed ? null : new Error('CORS policy violation'), isAllowed);
    },
    credentials:     true,
    allowedHeaders:  ['Content-Type', 'Authorization', 'X-Api-Key'],
    exposedHeaders:  ['X-RateLimit-Remaining'],
  }));

  // ── ② JSON parser (after Stripe raw body route) ──────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── ③ Global rate limit (200 req/min per IP) ─────────────────
  app.use('/api/', buildRateLimiter(60_000, 200, 'rl:global'));

  // ── Health check (no auth, no rate limit) ────────────────────
  app.get('/health', (_req, res) =>
    res.status(200).json({ status: 'ok', ts: new Date().toISOString() })
  );

  // ── White-label domain resolution ────────────────────────────
  app.use(whiteLabelMiddleware);

  // ── Public branding endpoint (Next.js white-label) ───────────
  app.get('/api/public/branding', brandingHandler);

  // ── Phase 2: Auth ─────────────────────────────────────────────
  app.use('/api/auth', buildRateLimiter(60_000, 30, 'rl:auth'), authRouter);

  // ── Phase 3: Messaging webhooks ───────────────────────────────
  app.use('/api/webhooks/meta',  metaWebhookRouter);
  app.use('/api/webhooks/waha',  wahaWebhookRouter);

  // ── Phase 4: Loyalty & Rewards ────────────────────────────────
  app.use('/api/loyalty', loyaltyRouter);

  // ── Phase 5: Automations ──────────────────────────────────────
  app.use('/api/automations', automationRouter);

  // ── Phase 6: Campaigns + Billing ─────────────────────────────
  app.use('/api/campaigns', campaignRouter);
  app.use('/api/billing',   billingRouter);

  // ── Phase 7: POS Webhooks + AI BI + CSV Import ───────────────
  app.use('/api/webhooks/pos', posWebhookRouter);
  app.use('/api/ai',           buildRateLimiter(60_000, 20, 'rl:ai'), aiBiRouter);
  app.use('/api/import',       importRouter);

  // ── Phase 8: Super Admin + GDPR ──────────────────────────────
  app.use('/api/admin', adminRouter);
  app.use('/api/gdpr',  _gdprRouter);

  // ── 404 handler ──────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'ROUTE_NOT_FOUND' });
  });

  // ── Global error handler ──────────────────────────────────────
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[app] Unhandled error:', err.message, {
      path:   req.path,
      method: req.method,
      stack:  process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    if (err.message === 'CORS policy violation') {
      res.status(403).json({ error: 'CORS_POLICY_VIOLATION' });
      return;
    }

    res.status(500).json({
      error:   'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
};

// ================================================================
// SERVER STARTUP
// ================================================================

const startServer = async (): Promise<void> => {
  const PORT = parseInt(process.env.PORT ?? '4000', 10);

  // ── Connectivity checks ──────────────────────────────────────
  console.log('🔌 Connecting to Redis...');
  await initRedis();

  console.log('🔌 Verifying database connection...');
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ PostgreSQL connected.');

  // ── Build Express app ────────────────────────────────────────
  const app = buildApp();

  // ── Start BullMQ workers (Phase 3) ───────────────────────────
  console.log('⚡ Starting BullMQ workers...');
  const workers = startAllWorkers();

  // ── Start nightly cron jobs (Phase 4) ────────────────────────
  console.log('🕐 Scheduling cron jobs...');
  startAllCronJobs();

  // ── Listen ───────────────────────────────────────────────────
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 Cube Retain CRM API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV ?? 'development'}`);
    console.log(`   API Base:    ${process.env.API_BASE_URL ?? `http://localhost:${PORT}`}`);
    console.log(`   Frontend:    ${process.env.FRONTEND_URL ?? 'http://localhost:3000'}\n`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n📴 ${signal} received — shutting down gracefully...`);

    // Stop accepting new connections
    server.close(async () => {
      try {
        await gracefulShutdown(workers);
        await prisma.$disconnect();
        await getRedisClient().quit();
        console.log('✅ Graceful shutdown complete.');
        process.exit(0);
      } catch (err) {
        console.error('Shutdown error:', err);
        process.exit(1);
      }
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      console.error('Forced exit after 30s timeout.');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[app] Unhandled Promise Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[app] Uncaught Exception:', err);
    shutdown('UNCAUGHT_EXCEPTION');
  });
};

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;
