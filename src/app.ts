import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { initRedis } from './config/redis';
import { initRedis as initTenantRedis } from './middleware/tenant-scope-middleware';
import { wahaWebhookRouter } from './services/messaging-gateway';

const prisma = new PrismaClient();
const app = express();

async function bootstrap() {
  await initRedis();
  await initTenantRedis();
  await prisma.$queryRaw`SELECT 1`;

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

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
