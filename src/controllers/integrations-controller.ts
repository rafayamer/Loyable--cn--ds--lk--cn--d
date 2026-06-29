// ================================================================
//  integrations-controller.ts
//  Integration Marketplace — configure POS / e-commerce / data sync.
//
//  Supported providers:
//    SQUARE      — POS (already handled by webhook-pos.ts for inbound)
//    SHOPIFY     — e-commerce: orders → visits, customers → loyalty
//    WOOCOMMERCE — order webhook → visit record
//    GOOGLE_SHEETS — 2-way customer sync (stub)
//    ZAPIER      — generic outbound webhook
//
//  Routes:
//    GET    /api/integrations              → list all configs for business
//    GET    /api/integrations/:provider    → get one
//    PUT    /api/integrations/:provider    → upsert config (enable/disable + keys)
//    DELETE /api/integrations/:provider    → disable + clear credentials
//    POST   /api/integrations/:provider/test → send test ping to verify creds
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';

export const integrationsRouter = Router();
integrationsRouter.use(tenantScope as any);

const OWNER_ONLY = [Role.TENANT_OWNER] as const;

const PROVIDERS = ['SQUARE', 'SHOPIFY', 'WOOCOMMERCE', 'GOOGLE_SHEETS', 'ZAPIER'] as const;
type Provider = typeof PROVIDERS[number];

function validateProvider(p: string): p is Provider {
  return PROVIDERS.includes(p as Provider);
}

/** GET /api/integrations */
integrationsRouter.get('/', requireRoles(...OWNER_ONLY) as any, async (req: Request, res: Response): Promise<void> => {
  const rows = await (prisma as any).integrationConfig.findMany({
    where:   { businessId: req.tenantContext.businessId },
    orderBy: { provider: 'asc' },
  });
  // Return all known providers, merging saved config
  const saved = new Map(rows.map((r: any) => [r.provider, r]));
  const result = PROVIDERS.map(p => saved.get(p) ?? { provider: p, isEnabled: false, configJson: {}, lastSyncAt: null });
  res.json(result);
});

/** GET /api/integrations/:provider */
integrationsRouter.get('/:provider', requireRoles(...OWNER_ONLY) as any, async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  if (!validateProvider(provider)) { res.status(400).json({ error: 'UNKNOWN_PROVIDER' }); return; }
  const row = await (prisma as any).integrationConfig.findFirst({
    where: { businessId: req.tenantContext.businessId, provider },
  });
  res.json(row ?? { provider, isEnabled: false, configJson: {}, lastSyncAt: null });
});

/** PUT /api/integrations/:provider — upsert (enable/disable + config) */
integrationsRouter.put('/:provider', requireRoles(...OWNER_ONLY) as any, async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  if (!validateProvider(provider)) { res.status(400).json({ error: 'UNKNOWN_PROVIDER' }); return; }

  const { isEnabled, config } = req.body;
  const { businessId } = req.tenantContext;

  const existing = await (prisma as any).integrationConfig.findFirst({ where: { businessId, provider } });

  const data = {
    businessId,
    provider,
    isEnabled:  isEnabled ?? existing?.isEnabled ?? false,
    configJson: config     ?? existing?.configJson ?? {},
    updatedAt:  new Date(),
  };

  let row: any;
  if (existing) {
    row = await (prisma as any).integrationConfig.update({ where: { id: existing.id }, data });
  } else {
    row = await (prisma as any).integrationConfig.create({ data: { ...data, id: require('crypto').randomUUID() } });
  }

  res.json(row);
});

/** DELETE /api/integrations/:provider */
integrationsRouter.delete('/:provider', requireRoles(...OWNER_ONLY) as any, async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  if (!validateProvider(provider)) { res.status(400).json({ error: 'UNKNOWN_PROVIDER' }); return; }
  const existing = await (prisma as any).integrationConfig.findFirst({
    where: { businessId: req.tenantContext.businessId, provider },
  });
  if (existing) {
    await (prisma as any).integrationConfig.update({
      where: { id: existing.id },
      data:  { isEnabled: false, configJson: {}, updatedAt: new Date() },
    });
  }
  res.json({ ok: true });
});

/** POST /api/integrations/:provider/test */
integrationsRouter.post('/:provider/test', requireRoles(...OWNER_ONLY) as any, async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  if (!validateProvider(provider)) { res.status(400).json({ error: 'UNKNOWN_PROVIDER' }); return; }

  // Provider-specific test pings
  try {
    const row = await (prisma as any).integrationConfig.findFirst({
      where: { businessId: req.tenantContext.businessId, provider },
    });
    const cfg = row?.configJson ?? {};

    switch (provider) {
      case 'SQUARE': {
        if (!cfg.accessToken) { res.json({ ok: false, error: 'ACCESS_TOKEN_REQUIRED' }); return; }
        const r = await fetch('https://connect.squareup.com/v2/merchants/me', {
          headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Square-Version': '2024-01-17' },
        });
        res.json({ ok: r.ok, statusCode: r.status });
        return;
      }
      case 'SHOPIFY': {
        if (!cfg.storeUrl || !cfg.apiKey) { res.json({ ok: false, error: 'STORE_URL_AND_API_KEY_REQUIRED' }); return; }
        const url = `https://${cfg.storeUrl}/admin/api/2024-01/shop.json`;
        const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': cfg.apiKey } });
        res.json({ ok: r.ok, statusCode: r.status });
        return;
      }
      case 'ZAPIER': {
        if (!cfg.webhookUrl) { res.json({ ok: false, error: 'WEBHOOK_URL_REQUIRED' }); return; }
        const r = await fetch(cfg.webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ type: 'TEST', source: 'Loyable' }),
        });
        res.json({ ok: r.ok, statusCode: r.status });
        return;
      }
      default:
        res.json({ ok: true, message: 'No live test available for this provider yet' });
    }
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});
