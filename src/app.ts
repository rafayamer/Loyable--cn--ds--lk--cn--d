import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { initRedis } from './config/redis';

const prisma = new PrismaClient();
const app = express();

async function bootstrap() {
  // ── 1. Redis first (controllers depend on it at import time) ──
  await initRedis();
  console.log('[app] Redis connected.');

  // ── 2. Database ping ──────────────────────────────────────────
  await prisma.$queryRaw`SELECT 1`;
  console.log('[app] Database connected.');

  // ── 3. Core middleware ────────────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // ── 4. Health check ───────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── 5. Routers (each wrapped so one broken import doesn't kill the server) ──
  const load = async (path: string, mountAt: string, label: string) => {
    try {
      const mod = await import(path);
      const router = mod.default ?? mod.router ?? mod[Object.keys(mod)[0]];
      if (router) app.use(mountAt, router);
      console.log(`[app] ✓ ${label}`);
    } catch (e) {
      console.warn(`[app] ✗ ${label} skipped:`, (e as Error).message);
    }
  };

  await load('./controllers/auth-controller',       '/api/auth',        'auth');
  await load('./controllers/loyalty-controller',    '/api/loyalty',     'loyalty');
  await load('./controllers/campaign-controller',   '/api/campaigns',   'campaigns');
  await load('./controllers/automation-controller', '/api/automations', 'automations');
  await load('./controllers/import-controller',     '/api/import',      'import');
  await load('./controllers/webhook-pos',           '/api/webhooks',    'webhooks');
  await load('./controllers/ai-bi-controller',      '/api/ai',          'ai-bi');
  await load('./routes/super-admin',                '/api/admin',       'super-admin');

  // ── 6. 404 catch-all ─────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // ── 7. Start ─────────────────────────────────────────────────
  const PORT = process.env.PORT ?? 4000;
  app.listen(PORT, () => {
    console.log(`[app] Server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[app] Fatal startup error:', err);
  process.exit(1);
});
