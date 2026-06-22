// ================================================================
//  website-cms-controller.ts
//  Public CMS API — Landing page content + Reviews + Partners
//
//  Public routes (no auth):
//   GET  /api/website/public          → All landing page data
//   GET  /api/website/reviews         → Approved reviews
//   POST /api/website/reviews         → Submit review
//   GET  /api/website/partners        → Active partners
//   GET  /api/website/blog            → Published posts
//   GET  /api/website/faq             → Visible FAQ items
//   POST /api/website/analytics/track → Track page view
//
//  Admin routes (PLATFORM_ADMINISTRATOR only):
//   GET/PUT /api/website/admin/settings
//   GET/PUT /api/website/admin/sections
//   CRUD    /api/website/admin/features
//   CRUD    /api/website/admin/pricing
//   CRUD    /api/website/admin/testimonials
//   CRUD    /api/website/admin/partners
//   CRUD    /api/website/admin/reviews  (approve/reject/pin/reply)
//   CRUD    /api/website/admin/blog
//   CRUD    /api/website/admin/faq
//   CRUD    /api/website/admin/banners
//   GET     /api/website/admin/analytics
// ================================================================

import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { tenantScope, requirePlatformAdmin } from '../middleware/tenant-scope-middleware';

export const websiteCmsRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────
const ok   = (res: Response, data: any) => res.json(data);
const err  = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

const DEFAULT_SETTINGS: Record<string, string> = {
  companyName:      'Loyable',
  tagline:          'Turn One-Time Customers Into Loyal Customers',
  heroSubtitle:     'Loyable helps businesses track visits, reward loyalty, automate marketing and bring customers back – all in one powerful platform.',
  heroCta1:         'Start Free Trial',
  heroCta2:         'Book a Demo',
  logoUrl:          '',
  primaryColor:     '#8b5cf6',
  accentColor:      '#7c3aed',
  supportEmail:     'support@loyable.io',
  whatsappContact:  '',
  instagramHandle:  '',
  facebookPage:     '',
  linkedinPage:     '',
  tiktokHandle:     '',
  termsUrl:         '#',
  privacyUrl:       '#',
  seoTitle:         'Loyable — WhatsApp Retention Platform',
  seoDescription:   'Loyalty programs, WhatsApp campaigns, AI analytics and POS — all in one platform for restaurants, salons, gyms and retail.',
  seoKeywords:      'loyalty program, whatsapp marketing, customer retention, CRM, SMB',
  announcementBar:  '',
  trustBadge1:      '14-Day Free Trial',
  trustBadge2:      'No Credit Card',
  trustBadge3:      'Setup in 2 Minutes',
};

async function getSetting(key: string): Promise<string> {
  const row = await prisma.websiteSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.websiteSetting.findMany();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function upsertSetting(key: string, value: string) {
  return prisma.websiteSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/website/public — Single call that returns everything needed for landing page
websiteCmsRouter.get('/public', async (_req: Request, res: Response) => {
  const [settings, sections, features, pricing, testimonials, partners, faq, banners, reviews] = await Promise.all([
    getAllSettings(),
    prisma.websiteSection.findMany({ orderBy: { order: 'asc' } }),
    prisma.featureCard.findMany({ where: { visible: true }, orderBy: { order: 'asc' } }),
    prisma.pricingPlan.findMany({ where: { visible: true }, orderBy: { order: 'asc' } }),
    prisma.cmsTestimonial.findMany({ where: { visible: true }, orderBy: { order: 'asc' } }),
    prisma.partnerBusiness.findMany({ where: { active: true, showOnHome: true }, orderBy: { createdAt: 'asc' } }),
    prisma.faqItem.findMany({ where: { visible: true }, orderBy: { order: 'asc' } }),
    prisma.announcementBanner.findMany({
      where: {
        active: true,
        OR: [
          { startsAt: null },
          { startsAt: { lte: new Date() } },
        ],
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.publicReview.findMany({
      where: { status: 'APPROVED', hidden: false },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 6,
    }),
  ]);

  // Build section visibility map
  const DEFAULT_SECTIONS = ['hero','features','partners','testimonials','pricing','reviews','blog','faq','cta','footer'];
  const sectionMap: Record<string, boolean> = {};
  for (const slug of DEFAULT_SECTIONS) sectionMap[slug] = true;
  for (const s of sections) sectionMap[s.slug] = s.visible;

  ok(res, { settings, sections: sectionMap, features, pricing, testimonials, partners, faq, banners, reviews });
});

// GET /api/website/reviews — paginated approved reviews
websiteCmsRouter.get('/reviews', async (req: Request, res: Response) => {
  const page  = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 12);
  const sort  = (req.query.sort as string) ?? 'newest';
  const q     = (req.query.q as string) ?? '';
  const stars = req.query.stars ? Number(req.query.stars) : undefined;

  const where: any = { status: 'APPROVED', hidden: false };
  if (q) where.OR = [{ authorName: { contains: q, mode: 'insensitive' } }, { comment: { contains: q, mode: 'insensitive' } }];
  if (stars) where.stars = stars;

  const orderBy: any = sort === 'rating' ? [{ stars: 'desc' }, { createdAt: 'desc' }] : [{ pinned: 'desc' }, { createdAt: 'desc' }];

  const [reviews, total] = await Promise.all([
    prisma.publicReview.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.publicReview.count({ where }),
  ]);

  ok(res, { reviews, total, page, pages: Math.ceil(total / limit) });
});

// POST /api/website/reviews — submit review
websiteCmsRouter.post('/reviews', async (req: Request, res: Response) => {
  const { authorName, authorEmail, avatarUrl, bizType, stars, comment } = req.body;
  if (!authorName || !comment || !stars) return err(res, 'Name, comment and stars are required');
  if (stars < 1 || stars > 5) return err(res, 'Stars must be 1-5');
  if (comment.length < 10) return err(res, 'Comment must be at least 10 characters');
  if (comment.length > 2000) return err(res, 'Comment too long');

  const review = await prisma.publicReview.create({
    data: { authorName, authorEmail, avatarUrl, bizType, stars: Number(stars), comment, status: 'PENDING' },
  });
  ok(res, { ok: true, id: review.id, message: 'Your review has been submitted for moderation.' });
});

// GET /api/website/partners
websiteCmsRouter.get('/partners', async (_req: Request, res: Response) => {
  const partners = await prisma.partnerBusiness.findMany({
    where: { active: true },
    orderBy: [{ featured: 'desc' }, { createdAt: 'asc' }],
  });
  ok(res, { partners });
});

// GET /api/website/blog
websiteCmsRouter.get('/blog', async (req: Request, res: Response) => {
  const page  = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 9);
  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({ where: { published: true }, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.blogPost.count({ where: { published: true } }),
  ]);
  ok(res, { posts, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/website/faq
websiteCmsRouter.get('/faq', async (_req: Request, res: Response) => {
  const items = await prisma.faqItem.findMany({ where: { visible: true }, orderBy: { order: 'asc' } });
  ok(res, { items });
});

// POST /api/website/analytics/track
websiteCmsRouter.post('/analytics/track', async (req: Request, res: Response) => {
  const { page, event, referer } = req.body;
  await prisma.websitePageView.create({ data: { page: page ?? '/', event: event ?? 'PAGE_VIEW', referer } });
  ok(res, { ok: true });
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES — PLATFORM_ADMINISTRATOR only
// ═══════════════════════════════════════════════════════════════
const adminGuard = [tenantScope, requirePlatformAdmin];

// ── Settings ──────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/settings', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await getAllSettings());
});

websiteCmsRouter.put('/admin/settings', adminGuard, async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  await Promise.all(Object.entries(updates).map(([k, v]) => upsertSetting(k, String(v ?? ''))));
  ok(res, await getAllSettings());
});

// ── Sections ──────────────────────────────────────────────────────
const DEFAULT_SECTION_LIST = [
  { slug:'hero',         label:'Hero Section',        order:0  },
  { slug:'features',     label:'Features Grid',       order:1  },
  { slug:'partners',     label:'Partner Logos',       order:2  },
  { slug:'howitworks',   label:'How It Works',        order:3  },
  { slug:'testimonials', label:'Testimonials',         order:4  },
  { slug:'pricing',      label:'Pricing',             order:5  },
  { slug:'reviews',      label:'Reviews',             order:6  },
  { slug:'blog',         label:'Blog',                order:7  },
  { slug:'faq',          label:'FAQ',                 order:8  },
  { slug:'cta',          label:'CTA Banner',          order:9  },
  { slug:'footer',       label:'Footer',              order:10 },
];

websiteCmsRouter.get('/admin/sections', adminGuard, async (_req: Request, res: Response) => {
  // Ensure all default sections exist
  await Promise.all(DEFAULT_SECTION_LIST.map(s =>
    prisma.websiteSection.upsert({ where: { slug: s.slug }, create: { ...s, visible: true }, update: {} })
  ));
  const sections = await prisma.websiteSection.findMany({ orderBy: { order: 'asc' } });
  ok(res, { sections });
});

websiteCmsRouter.put('/admin/sections/:slug', adminGuard, async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { visible } = req.body;
  const s = await prisma.websiteSection.upsert({
    where: { slug },
    create: { slug, label: slug, visible: !!visible, order: 99 },
    update: { visible: !!visible },
  });
  ok(res, s);
});

// ── Feature Cards ─────────────────────────────────────────────────
websiteCmsRouter.get('/admin/features', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.featureCard.findMany({ orderBy: { order: 'asc' } }));
});
websiteCmsRouter.post('/admin/features', adminGuard, async (req: Request, res: Response) => {
  const { icon, title, desc, order } = req.body;
  ok(res, await prisma.featureCard.create({ data: { icon, title, desc, order: order ?? 0 } }));
});
websiteCmsRouter.put('/admin/features/:id', adminGuard, async (req: Request, res: Response) => {
  const { icon, title, desc, order, visible } = req.body;
  ok(res, await prisma.featureCard.update({ where: { id: req.params.id }, data: { icon, title, desc, order, visible } }));
});
websiteCmsRouter.delete('/admin/features/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.featureCard.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Pricing Plans ─────────────────────────────────────────────────
websiteCmsRouter.get('/admin/pricing', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.pricingPlan.findMany({ orderBy: { order: 'asc' } }));
});
websiteCmsRouter.post('/admin/pricing', adminGuard, async (req: Request, res: Response) => {
  const { name, description, monthlyPrice, yearlyPrice, currency, features, ctaText, highlighted, order } = req.body;
  ok(res, await prisma.pricingPlan.create({ data: { name, description, monthlyPrice, yearlyPrice, currency: currency ?? 'GBP', features: features ?? [], ctaText: ctaText ?? 'Get Started', highlighted: !!highlighted, order: order ?? 0 } }));
});
websiteCmsRouter.put('/admin/pricing/:id', adminGuard, async (req: Request, res: Response) => {
  const { name, description, monthlyPrice, yearlyPrice, currency, features, ctaText, highlighted, visible, order } = req.body;
  ok(res, await prisma.pricingPlan.update({ where: { id: req.params.id }, data: { name, description, monthlyPrice, yearlyPrice, currency, features, ctaText, highlighted, visible, order } }));
});
websiteCmsRouter.delete('/admin/pricing/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.pricingPlan.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Testimonials ──────────────────────────────────────────────────
websiteCmsRouter.get('/admin/testimonials', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.cmsTestimonial.findMany({ orderBy: { order: 'asc' } }));
});
websiteCmsRouter.post('/admin/testimonials', adminGuard, async (req: Request, res: Response) => {
  const { name, business, avatarUrl, text, stars, order } = req.body;
  ok(res, await prisma.cmsTestimonial.create({ data: { name, business, avatarUrl, text, stars: stars ?? 5, order: order ?? 0 } }));
});
websiteCmsRouter.put('/admin/testimonials/:id', adminGuard, async (req: Request, res: Response) => {
  const { name, business, avatarUrl, text, stars, visible, order } = req.body;
  ok(res, await prisma.cmsTestimonial.update({ where: { id: req.params.id }, data: { name, business, avatarUrl, text, stars, visible, order } }));
});
websiteCmsRouter.delete('/admin/testimonials/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.cmsTestimonial.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Partners ──────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/partners', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.partnerBusiness.findMany({ orderBy: { createdAt: 'desc' } }));
});
websiteCmsRouter.post('/admin/partners', adminGuard, async (req: Request, res: Response) => {
  const { name, logoUrl, website, industry, location, description, active, featured, showOnHome } = req.body;
  ok(res, await prisma.partnerBusiness.create({ data: { name, logoUrl, website, industry, location, description, active: active !== false, featured: !!featured, showOnHome: showOnHome !== false } }));
});
websiteCmsRouter.put('/admin/partners/:id', adminGuard, async (req: Request, res: Response) => {
  const { name, logoUrl, website, industry, location, description, active, featured, showOnHome } = req.body;
  ok(res, await prisma.partnerBusiness.update({ where: { id: req.params.id }, data: { name, logoUrl, website, industry, location, description, active, featured, showOnHome } }));
});
websiteCmsRouter.delete('/admin/partners/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.partnerBusiness.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Reviews ───────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/reviews', adminGuard, async (req: Request, res: Response) => {
  const status = (req.query.status as string) ?? undefined;
  const where: any = status ? { status } : {};
  const reviews = await prisma.publicReview.findMany({ where, orderBy: { createdAt: 'desc' } });
  ok(res, { reviews });
});

websiteCmsRouter.put('/admin/reviews/:id', adminGuard, async (req: Request, res: Response) => {
  const { status, pinned, hidden, replyText, comment } = req.body;
  const update: any = {};
  if (status !== undefined)    update.status  = status;
  if (pinned !== undefined)    update.pinned  = !!pinned;
  if (hidden !== undefined)    update.hidden  = !!hidden;
  if (comment !== undefined)   update.comment = comment;
  if (replyText !== undefined) { update.replyText = replyText; update.repliedAt = new Date(); }
  ok(res, await prisma.publicReview.update({ where: { id: req.params.id }, data: update }));
});

websiteCmsRouter.delete('/admin/reviews/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.publicReview.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Blog ──────────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/blog', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.blogPost.findMany({ orderBy: { createdAt: 'desc' } }));
});
websiteCmsRouter.post('/admin/blog', adminGuard, async (req: Request, res: Response) => {
  const { title, slug, summary, content, coverImage, published, tags, seoTitle, seoDesc } = req.body;
  const s = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  ok(res, await prisma.blogPost.create({ data: { title, slug: s, summary, content, coverImage, published: !!published, tags: tags ?? [], seoTitle, seoDesc } }));
});
websiteCmsRouter.put('/admin/blog/:id', adminGuard, async (req: Request, res: Response) => {
  const { title, slug, summary, content, coverImage, published, tags, seoTitle, seoDesc } = req.body;
  ok(res, await prisma.blogPost.update({ where: { id: req.params.id }, data: { title, slug, summary, content, coverImage, published, tags, seoTitle, seoDesc } }));
});
websiteCmsRouter.delete('/admin/blog/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.blogPost.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── FAQ ───────────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/faq', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.faqItem.findMany({ orderBy: { order: 'asc' } }));
});
websiteCmsRouter.post('/admin/faq', adminGuard, async (req: Request, res: Response) => {
  const { question, answer, order } = req.body;
  ok(res, await prisma.faqItem.create({ data: { question, answer, order: order ?? 0 } }));
});
websiteCmsRouter.put('/admin/faq/:id', adminGuard, async (req: Request, res: Response) => {
  const { question, answer, order, visible } = req.body;
  ok(res, await prisma.faqItem.update({ where: { id: req.params.id }, data: { question, answer, order, visible } }));
});
websiteCmsRouter.delete('/admin/faq/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.faqItem.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Banners ───────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/banners', adminGuard, async (_req: Request, res: Response) => {
  ok(res, await prisma.announcementBanner.findMany({ orderBy: { createdAt: 'desc' } }));
});
websiteCmsRouter.post('/admin/banners', adminGuard, async (req: Request, res: Response) => {
  const { text, linkText, linkUrl, type, active, startsAt, endsAt } = req.body;
  ok(res, await prisma.announcementBanner.create({ data: { text, linkText, linkUrl, type: type ?? 'INFO', active: active !== false, startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null } }));
});
websiteCmsRouter.put('/admin/banners/:id', adminGuard, async (req: Request, res: Response) => {
  const { text, linkText, linkUrl, type, active, startsAt, endsAt } = req.body;
  ok(res, await prisma.announcementBanner.update({ where: { id: req.params.id }, data: { text, linkText, linkUrl, type, active, startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null } }));
});
websiteCmsRouter.delete('/admin/banners/:id', adminGuard, async (req: Request, res: Response) => {
  await prisma.announcementBanner.delete({ where: { id: req.params.id } });
  ok(res, { ok: true });
});

// ── Analytics ─────────────────────────────────────────────────────
websiteCmsRouter.get('/admin/analytics', adminGuard, async (_req: Request, res: Response) => {
  const now   = new Date();
  const day30 = new Date(now.getTime() - 30 * 86400000);
  const day7  = new Date(now.getTime() - 7  * 86400000);

  const [total30, total7, byPage, byEvent, recent] = await Promise.all([
    prisma.websitePageView.count({ where: { createdAt: { gte: day30 } } }),
    prisma.websitePageView.count({ where: { createdAt: { gte: day7  } } }),
    prisma.websitePageView.groupBy({ by: ['page'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),
    prisma.websitePageView.groupBy({ by: ['event'], _count: { id: true } }),
    prisma.websitePageView.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const pendingReviews = await prisma.publicReview.count({ where: { status: 'PENDING' } });

  ok(res, { total30, total7, byPage, byEvent, recent, pendingReviews });
});
