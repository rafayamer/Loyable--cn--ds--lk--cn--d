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
import { lsConfigured, lsWebhookConfigured, slugToPlan, TIER_QUOTA } from '../config/lemonsqueezy';
import { isBillingTestKey } from '../config/promo-codes';
import { sendEmail, emailProvider } from '../utils/email.util';

const appUrl = () => process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.theloyaly.com';

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

// POST /api/billing/simulate { plan, code } — TEST ONLY. If the master test key
// matches, simulate a successful payment: activate the plan for 1 month and send
// a confirmation email. Bypasses Lemon Squeezy. Owner-only, audit-logged.
lsBillingRouter.post('/simulate', requireRoles(Role.TENANT_OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const planSlug = String(req.body?.plan ?? '');
    const code = String(req.body?.code ?? '');
    if (!isBillingTestKey(code)) { res.status(403).json({ error: 'INVALID_TEST_KEY' }); return; }
    const plan = slugToPlan(planSlug);
    if (!plan) { res.status(400).json({ error: 'INVALID_PLAN' }); return; }

    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    const quota = TIER_QUOTA[plan.tier];
    await prisma.subscription.upsert({
      where: { businessId },
      update: { tier: plan.tier as any, status: 'ACTIVE', planSlug: plan.slug, monthlyMessageQuota: quota, messagesUsedThisPeriod: 0, currentPeriodStart: new Date(), currentPeriodEnd: periodEnd, renewsAt: periodEnd, lsVariantId: plan.variantId, lastSyncedAt: new Date() },
      create: { businessId, tier: plan.tier as any, status: 'ACTIVE', planSlug: plan.slug, monthlyMessageQuota: quota, messagesUsedThisPeriod: 0, currentPeriodStart: new Date(), currentPeriodEnd: periodEnd, renewsAt: periodEnd, lsVariantId: plan.variantId, lastSyncedAt: new Date() },
    });
    await prisma.auditLog.create({ data: { businessId, userId, action: 'BILLING_TEST_SIMULATED', metaJson: { plan: plan.slug, tier: plan.tier, until: periodEnd.toISOString() } } }).catch(() => {});

    // Confirmation email (simulated receipt) — best-effort.
    const owner = await prisma.user.findFirst({ where: { id: userId }, select: { email: true, name: true } });
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
    let emailStatus = 'SKIPPED';
    if (emailProvider() !== 'none' && owner?.email) {
      const until = periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;background:#FBF7F2;padding:24px;border-radius:14px">
        <div style="font-size:13px;color:#E8743B;font-weight:800;letter-spacing:.5px">THE LOYALY</div>
        <h1 style="font-size:20px;color:#241B17;margin:8px 0">Payment confirmed 🎉</h1>
        <p style="font-size:15px;color:#241B17;line-height:1.6">Thank you for choosing The Loyaly. Your <b>${plan.name}</b> subscription is confirmed for <b>${biz?.name ?? 'your business'}</b> and is active until <b>${until}</b>.</p>
        <p style="font-size:14px;color:#6b5d52">You can now use everything included in ${plan.name}. Open The Loyaly to continue setting up.</p>
        <a href="${appUrl()}" style="display:inline-block;background:#E8743B;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;margin-top:8px">Open The Loyaly</a>
        <p style="font-size:11px;color:#a99c90;margin-top:18px">This is a test activation — no payment was charged.</p>
      </div>`;
      try { await sendEmail({ to: owner.email, subject: `Your The Loyaly ${plan.name} subscription is confirmed`, templateId: 'billing_confirmation', variables: {}, html }); emailStatus = 'SENT'; }
      catch { emailStatus = 'FAILED'; }
    }

    const ent = await getTenantEntitlements(businessId);
    res.json({ ok: true, simulated: true, tier: plan.tier, planName: plan.name, activeUntil: periodEnd, emailStatus, entitlements: ent });
  } catch (err) {
    console.error('[ls.simulate]', (err as Error).message);
    res.status(500).json({ error: 'SIMULATE_FAILED' });
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
