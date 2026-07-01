// ================================================================
//  screens-controller.ts
//  "Screens" = display/terminal logins that open straight into ONE
//  locked panel (POS till, kitchen, inventory, dashboard, …). Owner-only.
//  A business can run many screens; each gets a login
//    screen{n}{business}{branch}@theloyaly.com
//  with an owner-set password that stays viewable in Settings (stored
//  encrypted, auth still uses the Argon2 hash).
// ================================================================
import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { hashPassword } from '../services/token-service';
import { encryptSecret, decryptSecret } from '../utils/reversible-crypto.util';

export const screensRouter = Router();
screensRouter.use(tenantScope as any);
screensRouter.use(requireRoles(Role.TENANT_OWNER) as any);

const PANELS = ['dashboard_analytics', 'pos_full', 'pos_sales', 'pos_kitchen', 'inventory', 'crm', 'all'] as const;
type Panel = typeof PANELS[number];

// Least-privilege platform role that unlocks each panel's APIs.
const roleForPanel = (panel: Panel): Role =>
  panel === 'crm' ? Role.MARKETING_STAFF
  : (panel === 'dashboard_analytics' || panel === 'all') ? Role.BRANCH_MANAGER
  : Role.CASHIER; // pos_* / inventory

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => { fn(req, res).catch((e) => { console.error('[screens]', e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }); };

const bz = (req: Request) => req.tenantContext.businessId;

const shape = (u: any) => ({
  id: u.id, email: u.email, screenPanel: u.screenPanel, screenNumber: u.screenNumber,
  branchLocationId: u.branchLocationId, isActive: u.isActive, name: u.name,
  password: decryptSecret(u.displayPassword),
});

// GET /screens — list all screens with their (decrypted) passwords for the owner.
screensRouter.get('/', wrap(async (req, res) => {
  const rows = await prisma.user.findMany({ where: { businessId: bz(req), screenPanel: { not: null } }, orderBy: { screenNumber: 'asc' } });
  res.json({ screens: rows.map(shape) });
}));

// POST /screens — create a screen login.
screensRouter.post('/', wrap(async (req, res) => {
  const businessId = bz(req);
  const b = req.body ?? {};
  const panel = String(b.panel) as Panel;
  if (!PANELS.includes(panel)) { res.status(400).json({ error: 'INVALID_PANEL' }); return; }
  const password = String(b.password ?? '');
  if (password.length < 4) { res.status(400).json({ error: 'PASSWORD_TOO_SHORT' }); return; }

  let branchNum = 1;
  if (b.branchLocationId) {
    const ordered = await prisma.branchLocation.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const idx = ordered.findIndex((x) => x.id === b.branchLocationId);
    branchNum = idx >= 0 ? idx + 1 : 1;
  }
  // Next screen number for this business.
  const count = await prisma.user.count({ where: { businessId, screenPanel: { not: null } } });
  const screenNumber = count + 1;
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const bizPart = (biz?.name || 'biz').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'biz';

  const mkEmail = (n: number) => `screen${n}${bizPart}${branchNum}@theloyaly.com`;
  let email = mkEmail(screenNumber);
  for (let i = 0; i < 6; i++) {
    const clash = await prisma.user.findFirst({ where: { email, businessId }, select: { id: true } });
    if (!clash) break;
    email = mkEmail(screenNumber + i + 1);
    if (i === 5) { res.status(400).json({ error: 'COULD_NOT_GENERATE_EMAIL' }); return; }
  }

  const user = await prisma.user.create({
    data: {
      businessId, name: `Screen ${screenNumber} · ${panel}`, email,
      passwordHash: await hashPassword(password), displayPassword: encryptSecret(password),
      role: roleForPanel(panel), screenPanel: panel, screenNumber,
      branchLocationId: b.branchLocationId ?? null,
    } as any,
  });
  res.status(201).json({ screen: shape(user) });
}));

// PATCH /screens/:id — change panel / password / active.
screensRouter.patch('/:id', wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, businessId, screenPanel: { not: null } } });
  if (!existing) { res.status(404).json({ error: 'SCREEN_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  const data: any = {};
  if (b.panel && PANELS.includes(b.panel)) { data.screenPanel = b.panel; data.role = roleForPanel(b.panel); }
  if (typeof b.isActive === 'boolean') data.isActive = b.isActive;
  if (b.password && String(b.password).length >= 4) {
    data.passwordHash = await hashPassword(String(b.password));
    data.displayPassword = encryptSecret(String(b.password));
  }
  const user = await prisma.user.update({ where: { id: existing.id }, data });
  res.json({ screen: shape(user) });
}));

// DELETE /screens/:id
screensRouter.delete('/:id', wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, businessId, screenPanel: { not: null } } });
  if (!existing) { res.status(404).json({ error: 'SCREEN_NOT_FOUND' }); return; }
  await prisma.userSession.deleteMany({ where: { userId: existing.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));
