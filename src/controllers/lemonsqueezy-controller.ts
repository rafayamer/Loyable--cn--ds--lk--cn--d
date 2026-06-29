// ================================================================
//  lemonsqueezy-controller.ts
//  - POST /api/billing/checkout       → create plan-specific checkout (auth)
//  - GET  /api/billing/subscription   → current plan/status (success-page poll)
//  - POST /api/webhooks/lemonsqueezy  → verified, idempotent webhook (raw body)
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { getTenantEntitlements } from '../services/entitlement-service';
import { createCheckout, processWebhook } from '../services/lemonsqueezy-service';
import { lsConfigured, lsWebhookConfigured } from '../config/lemonsqueezy';

// ── Authenticated billing routes (mounted at /api/billing) ──────────
export const lsBillingRouter = Router();
lsBillingRouter.use(tenantScope as any);

// POST /api/billing/checkout { plan } — owner creates a checkout for THEIR business.
lsBillingRouter.post('/checkout', requireRoles(Role.TENANT_OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const planSlug = String(req.body?.plan ?? '');
    const owner = await prisma.user.findFirst({ where: { id: userId }, select: { email: true } });
    const { url, metadataAttached } = await createCheckout({ planSlug, userId, businessId, email: owner?.email });
    await prisma.auditLog.create({ data: { businessId, userId, action: 'BILLING_CHECKOUT_CREATED', metaJson: { plan: planSlug, metadataAttached } } }).catch(() => {});
    res.json({ url, metadataAttached });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'INVALID_PLAN') { res.status(400).json({ error: 'INVALID_PLAN' }); return; }
    console.error('[ls.checkout]', msg);
    res.status(502).json({ error: 'CHECKOUT_FAILED', message: 'Could not start checkout. The store may still be activating.' });
  }
});

// GET /api/billing/subscription — used by /billing/success to poll activation.
lsBillingRouter.get('/subscription', async (req: Request, res: Response): Promise<void> => {
  try {
    const ent = await getTenantEntitlements(req.tenantContext.businessId);
    const sub = await prisma.subscription.findUnique({
      where: { businessId: req.tenantContext.businessId },
      select: { tier: true, status: true, planSlug: true, renewsAt: true, currentPeriodEnd: true, trialEndsAt: true },
    });
    res.json({
      tier: ent.effectiveTier, planName: ent.planName, status: ent.status, active: ent.active,
      trial: ent.trial, planSlug: sub?.planSlug ?? null, renewsAt: sub?.renewsAt ?? sub?.currentPeriodEnd ?? null,
      storeActivationPending: !lsConfigured(),
    });
  } catch {
    res.status(500).json({ error: 'SUBSCRIPTION_LOOKUP_FAILED' });
  }
});

// ── Webhook (mounted at /api/webhooks/lemonsqueezy; raw body, no tenantScope) ──
export const lsWebhookRouter = Router();
lsWebhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!lsWebhookConfigured()) { res.status(503).json({ error: 'WEBHOOK_NOT_CONFIGURED' }); return; }
    const signature = req.headers['x-signature'] as string | undefined;
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const result = await processWebhook(raw, signature);
    res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'INVALID_SIGNATURE') { res.status(401).json({ error: 'INVALID_SIGNATURE' }); return; }
    // Never crash the webhook endpoint — log and 200 so LS doesn't hammer retries
    // for an unparseable/unknown payload (signature already validated above).
    console.error('[ls.webhook]', msg);
    res.status(200).json({ ok: false, error: 'PROCESSING_ERROR' });
  }
});
