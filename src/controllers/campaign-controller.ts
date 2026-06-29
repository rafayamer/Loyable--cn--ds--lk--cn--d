// ================================================================
//  campaign.controller.ts  +  stripe.controller.ts
//  Two Express routers exported from one file.
//
//  campaignRouter  → mounted at /api/campaigns
//  stripeRouter    → mounted at /api/webhooks/stripe
//
//  CRITICAL: The Stripe webhook route MUST receive a raw Buffer body.
//  Mount it BEFORE any global express.json() middleware, or use the
//  express.raw() override shown in the mount instructions below.
// ================================================================

import { Request, Response, NextFunction, Router } from 'express';
import { z, ZodError }                             from 'zod';
import { Role }                      from '@prisma/client';
import { prisma } from '../config/prisma';


import {
  createCampaign,
  updateCampaign,
  listCampaigns,
  getCampaignById,
  getCampaignStats,
  getCampaignAbStats,
  launchCampaign,
  scheduleCampaign,
  pauseCampaign,
  buildMessagePayloadFromLayout,
  CampaignLayout,
} from '../services/campaign-service';

import {
  handleStripeWebhook,
  createCheckoutSession,
  createBillingPortalSession,
  getSubscriptionForBusiness,
  hasFeature,
} from '../services/stripe-service';

import {
  tenantScope,
  requireRoles,
  requirePlatformAdmin,
} from '../middleware/tenant-scope-middleware';

// ================================================================
// CAMPAIGN — ZOD SCHEMAS
// ================================================================

const LayoutBlockSchema = z.object({
  id:            z.string().min(1),
  type:          z.enum(['TEXT', 'IMAGE', 'VIDEO', 'COUPON', 'URL_BUTTON', 'AI_ASSIST']),
  order:         z.number().int().min(0),
  content:       z.string().max(4096).optional(),
  mediaUrl:      z.string().url().optional(),
  caption:       z.string().max(1024).optional(),
  couponId:      z.string().optional(),
  discountText:  z.string().max(200).optional(),
  couponCode:    z.string().max(50).optional(),
  label:         z.string().max(25).optional(),
  url:           z.string().url().optional(),
});

const CampaignLayoutSchema = z.object({
  blocks: z.array(LayoutBlockSchema).min(1).max(20),
});

const CreateCampaignSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(500).optional(),
  targetSegment:  z.enum(['NEW','LOYAL','VIP','AT_RISK','LOST','BIG_SPENDER','COUPON_HUNTER','ALL']).optional(),
  layoutJson:     CampaignLayoutSchema,
  templateName:   z.string().max(100).optional(),
  channel:        z.enum(['WHATSAPP_META','WHATSAPP_WAHA','EMAIL','SMS']).optional(),
  scheduledFor:   z.coerce.date().optional(),
});

const UpdateCampaignSchema = CreateCampaignSchema.partial();

const ScheduleSchema = z.object({
  scheduledFor: z.coerce.date().refine(d => d > new Date(), 'Must be a future date'),
});

const PreviewPayloadSchema = z.object({
  layoutJson:   CampaignLayoutSchema,
  customerName: z.string().min(1).default('Sarah'),
  provider:     z.enum(['META','WAHA']).default('META'),
});

// ================================================================
// STRIPE — ZOD SCHEMAS
// ================================================================

const CheckoutSchema = z.object({
  priceId:   z.string().min(1, 'Stripe Price ID is required'),
  returnUrl: z.string().url('returnUrl must be a valid URL').optional(),
});

const PortalSchema = z.object({
  returnUrl: z.string().url().optional(),
});

// ================================================================
// SHARED MIDDLEWARE
// ================================================================

const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error:  'VALIDATION_ERROR',
          fields: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
      } else next(err);
    }
  };

// ================================================================
// CAMPAIGN ERROR HANDLER
// ================================================================

const CAMPAIGN_ERROR_STATUS: Record<string, number> = {
  CAMPAIGN_NOT_FOUND:          404,
  CAMPAIGN_ALREADY_ACTIVE:     409,
  CAMPAIGN_ALREADY_LAUNCHED:   409,
  CAMPAIGN_ALREADY_COMPLETED:  410,
  CAMPAIGN_HAS_NO_LAYOUT:      422,
  INVALID_LAYOUT:              422,
  INSUFFICIENT_QUOTA:          402,
  SCHEDULED_TIME_MUST_BE_FUTURE: 400,
  FEATURE_NOT_AVAILABLE:       402,
};

const handleCampaignError = (err: unknown, res: Response): void => {
  const msg    = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
  const base   = msg.split(':')[0].trim();
  const status = CAMPAIGN_ERROR_STATUS[base] ?? 500;
  if (status === 500) console.error('[campaign.controller]', err);
  res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : msg });
};

// ================================================================
// CAMPAIGN HANDLERS
// ================================================================

/** GET /api/campaigns */
const listHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await listCampaigns(req.tenantContext.businessId);
    // Shape denormalized counters into a `stats` object the client expects
    const campaigns = (rows as any[]).map((c) => ({
      ...c,
      stats: {
        sent:      c.sentCount      ?? 0,
        delivered: c.deliveredCount ?? 0,
        read:      c.readCount      ?? 0,
        failed:    c.failedCount    ?? 0,
        dropped:   c.droppedCount   ?? 0,
      },
    }));
    res.status(200).json({ campaigns, total: campaigns.length });
  } catch (err) { handleCampaignError(err, res); }
};

/** POST /api/campaigns */
const createHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;

    // Feature gate: basic_campaigns required for all tiers except explicitly blocked
    const allowed = await hasFeature(businessId, 'basic_campaigns');
    if (!allowed) {
      res.status(402).json({ error: 'FEATURE_NOT_AVAILABLE', upgrade: '/settings/billing' });
      return;
    }

    const { role } = req.tenantContext;
    const biz = await (prisma as any).business.findUnique({ where: { id: businessId }, select: { requiresCampaignApproval: true } });
    const needsApproval = biz?.requiresCampaignApproval && role === 'MARKETING_STAFF';
    const campaign = await createCampaign(businessId, { ...req.body, _forceStatus: needsApproval ? 'PENDING_APPROVAL' : undefined });
    res.status(201).json(campaign);
  } catch (err) { handleCampaignError(err, res); }
};

/** GET /api/campaigns/:id */
const getHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const campaign = await getCampaignById(req.params.id, req.tenantContext.businessId);
    res.status(200).json(campaign);
  } catch (err) { handleCampaignError(err, res); }
};

/** GET /api/campaigns/:id/stats */
const statsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getCampaignStats(req.params.id, req.tenantContext.businessId);
    res.status(200).json(stats);
  } catch (err) { handleCampaignError(err, res); }
};

/** GET /api/campaigns/:id/ab-stats */
const abStatsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getCampaignAbStats(req.params.id, req.tenantContext.businessId);
    res.status(200).json(result);
  } catch (err) { handleCampaignError(err, res); }
};

/** PUT /api/campaigns/:id */
const updateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const campaign = await updateCampaign(
      req.params.id,
      req.tenantContext.businessId,
      req.body
    );
    res.status(200).json(campaign);
  } catch (err) { handleCampaignError(err, res); }
};

/** POST /api/campaigns/:id/launch — immediate dispatch */
const launchHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await launchCampaign(req.params.id, req.tenantContext.businessId);
    res.status(200).json({
      ...result,
      message: `Campaign launched. ${result.queued} messages queued via BullMQ.`,
    });
  } catch (err) { handleCampaignError(err, res); }
};

/** POST /api/campaigns/:id/schedule */
const scheduleHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scheduledFor } = req.body as z.infer<typeof ScheduleSchema>;
    await scheduleCampaign(req.params.id, req.tenantContext.businessId, scheduledFor);
    res.status(200).json({
      message: `Campaign scheduled for ${scheduledFor.toISOString()}.`,
      scheduledFor,
    });
  } catch (err) { handleCampaignError(err, res); }
};

/** POST /api/campaigns/:id/pause */
const pauseHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    await pauseCampaign(req.params.id, req.tenantContext.businessId);
    res.status(200).json({ message: 'Campaign paused. Queued messages will still deliver.' });
  } catch (err) { handleCampaignError(err, res); }
};

/**
 * POST /api/campaigns/preview-payload
 * Render a layoutJson into a MessagePayload without saving or dispatching.
 * Used by the canvas "Preview as WhatsApp" button.
 */
const cloneHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const src = await getCampaignById(req.params.id, businessId) as any;
    // Whitelist only the content fields. Everything else (stats counters,
    // approval state, A/B winner, schedule) MUST reset to defaults on a clone.
    const cloned = await prisma.campaign.create({
      data: {
        businessId,
        name:          `Copy of ${src.name}`,
        description:   src.description ?? null,
        targetSegment: src.targetSegment ?? null,
        layoutJson:    src.layoutJson ?? undefined,
        channel:       src.channel,
        abVariants:    src.abVariants ?? undefined,
        status:        'DRAFT',
        // scheduledFor, *Count, approvedAt, rejectionReason, abWinnerId,
        // abTestStartedAt all fall back to schema defaults (null / 0).
      },
    });
    res.status(201).json({ campaign: cloned });
  } catch (err: any) {
    if (err.message === 'CAMPAIGN_NOT_FOUND') { res.status(404).json({ error: 'Campaign not found' }); return; }
    console.error('[campaign:clone]', err);
    res.status(500).json({ error: 'Failed to clone campaign' });
  }
};

const previewPayloadHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { layoutJson, customerName, provider } =
      req.body as z.infer<typeof PreviewPayloadSchema>;

    const payload = buildMessagePayloadFromLayout(
      layoutJson as CampaignLayout,
      { fullName: customerName },
      'Your Business Name',
      provider
    );

    res.status(200).json({
      payload,
      preview: {
        type:     payload.type,
        bodyText: 'body' in payload ? payload.body : ('caption' in payload ? payload.caption : ''),
        mediaUrl: 'mediaUrl' in payload ? payload.mediaUrl : null,
      },
    });
  } catch (err) { handleCampaignError(err, res); }
};

// ================================================================
// CAMPAIGN ROUTER
// ================================================================

export const campaignRouter = Router();
campaignRouter.use(tenantScope as any);

campaignRouter.get(
  '/',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  listHandler
);

campaignRouter.post(
  '/',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(CreateCampaignSchema) as any,
  createHandler
);

campaignRouter.get(
  '/:id',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  getHandler
);

campaignRouter.get(
  '/:id/stats',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  statsHandler
);

campaignRouter.get(
  '/:id/ab-stats',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  abStatsHandler
);

campaignRouter.put(
  '/:id',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(UpdateCampaignSchema) as any,
  updateHandler
);

campaignRouter.post(
  '/:id/launch',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  launchHandler
);

campaignRouter.post(
  '/:id/schedule',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(ScheduleSchema) as any,
  scheduleHandler
);

campaignRouter.post(
  '/:id/pause',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  pauseHandler
);

campaignRouter.post(
  '/:id/clone',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  cloneHandler
);

campaignRouter.post(
  '/preview-payload',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(PreviewPayloadSchema) as any,
  previewPayloadHandler
);

/** POST /api/campaigns/:id/approve — TENANT_OWNER only */
campaignRouter.post(
  '/:id/approve',
  requireRoles(Role.TENANT_OWNER) as any,
  async (req: Request, res: Response): Promise<void> => {
    const { businessId } = req.tenantContext;
    const existing = await (prisma as any).campaign.findFirst({ where: { id: req.params.id, businessId }, select: { status: true } });
    if (!existing) { res.status(404).json({ error: 'CAMPAIGN_NOT_FOUND' }); return; }
    if (existing.status !== 'PENDING_APPROVAL') { res.status(400).json({ error: 'CAMPAIGN_NOT_PENDING_APPROVAL' }); return; }
    const updated = await (prisma as any).campaign.update({ where: { id: req.params.id }, data: { status: 'DRAFT', approvedAt: new Date() } });
    res.json(updated);
  }
);

/** POST /api/campaigns/:id/reject — TENANT_OWNER only */
campaignRouter.post(
  '/:id/reject',
  requireRoles(Role.TENANT_OWNER) as any,
  async (req: Request, res: Response): Promise<void> => {
    const { businessId } = req.tenantContext;
    const { reason } = req.body;
    const existing = await (prisma as any).campaign.findFirst({ where: { id: req.params.id, businessId }, select: { status: true } });
    if (!existing) { res.status(404).json({ error: 'CAMPAIGN_NOT_FOUND' }); return; }
    if (existing.status !== 'PENDING_APPROVAL') { res.status(400).json({ error: 'CAMPAIGN_NOT_PENDING_APPROVAL' }); return; }
    const updated = await (prisma as any).campaign.update({ where: { id: req.params.id }, data: { status: 'REJECTED', rejectionReason: reason ?? null } });
    res.json(updated);
  }
);

// ================================================================
// STRIPE HANDLERS
// ================================================================

/**
 * POST /api/webhooks/stripe
 *
 * Raw body MUST be preserved — express.raw() is applied at the
 * route level below, NOT globally. This is intentional.
 */
const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'] as string | undefined;

  if (!signature) {
    res.status(400).json({ error: 'Missing stripe-signature header.' });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Request body must be raw Buffer. Use express.raw() middleware.' });
    return;
  }

  try {
    const result = await handleStripeWebhook(req.body, signature);
    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WEBHOOK_ERROR';
    if (msg.startsWith('WEBHOOK_SIGNATURE_INVALID')) {
      res.status(401).json({ error: msg });
    } else {
      console.error('[stripe.webhook]', err);
      res.status(500).json({ error: 'INTERNAL_WEBHOOK_ERROR' });
    }
  }
};

/** POST /api/billing/checkout */
const checkoutHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { priceId, returnUrl } = req.body as z.infer<typeof CheckoutSchema>;
    const { businessId }         = req.tenantContext;

    const session = await createCheckoutSession(
      businessId,
      priceId,
      returnUrl ?? process.env.FRONTEND_URL ?? ''
    );

    res.status(200).json(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'CHECKOUT_ERROR';
    res.status(500).json({ error: msg });
  }
};

/** POST /api/billing/portal */
const portalHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { returnUrl }  = (req.body ?? {}) as z.infer<typeof PortalSchema>;
    const { businessId } = req.tenantContext;

    const url = await createBillingPortalSession(
      businessId,
      returnUrl ?? `${process.env.FRONTEND_URL}/settings/billing`
    );

    res.status(200).json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PORTAL_ERROR';
    const status = msg === 'NO_STRIPE_CUSTOMER: Complete a checkout session first.' ? 402 : 500;
    res.status(status).json({ error: msg });
  }
};

/** GET /api/billing */
const billingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getSubscriptionForBusiness(req.tenantContext.businessId);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'BILLING_FETCH_ERROR' });
  }
};

/** GET /api/billing/features/:feature — feature flag check */
const featureCheckHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const enabled = await hasFeature(req.tenantContext.businessId, req.params.feature);
    res.status(200).json({ feature: req.params.feature, enabled });
  } catch (err) {
    res.status(500).json({ error: 'FEATURE_CHECK_ERROR' });
  }
};

// ================================================================
// STRIPE WEBHOOK ROUTER (express.raw applied at route level)
// ================================================================

import express from 'express';

export const stripeWebhookRouter = Router();

// Raw body — no JSON parsing — Stripe signature requires original bytes
stripeWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

// ================================================================
// BILLING ROUTER (for checkout + portal — JSON body)
// ================================================================

export const billingRouter = Router();
billingRouter.use(tenantScope as any);

billingRouter.get(
  '/',
  requireRoles(Role.TENANT_OWNER) as any,
  billingHandler
);

billingRouter.get(
  '/features/:feature',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF, Role.CASHIER) as any,
  featureCheckHandler
);

billingRouter.post(
  '/checkout',
  requireRoles(Role.TENANT_OWNER) as any,
  validate(CheckoutSchema) as any,
  checkoutHandler
);

billingRouter.post(
  '/portal',
  requireRoles(Role.TENANT_OWNER) as any,
  validate(PortalSchema) as any,
  portalHandler
);

// ================================================================
//  MOUNT IN app.ts — ORDER MATTERS:
//
//  // ① Stripe webhook BEFORE global express.json()
//  app.use('/api/webhooks/stripe', stripeWebhookRouter);
//
//  // ② Global JSON parser
//  app.use(express.json());
//
//  // ③ Remaining routers
//  app.use('/api/campaigns', campaignRouter);
//  app.use('/api/billing',   billingRouter);
// ================================================================
