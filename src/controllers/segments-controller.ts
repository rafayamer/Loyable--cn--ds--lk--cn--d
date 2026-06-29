// ================================================================
//  segments-controller.ts
//  Custom (no-code) segment builder API.
//
//  Routes:
//    GET    /api/segments              → list custom segments
//    POST   /api/segments              → create custom segment
//    PUT    /api/segments/:id          → update custom segment
//    DELETE /api/segments/:id          → delete custom segment
//    POST   /api/segments/:id/evaluate → evaluate → customer IDs + count
//    POST   /api/segments/evaluate     → evaluate without saving (preview)
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { tenantScope } from '../middleware/tenant-scope-middleware';
import { requireRoles } from '../middleware/tenant-scope-middleware';
import {
  listCustomSegments,
  createCustomSegment,
  updateCustomSegment,
  deleteCustomSegment,
  evaluateSegment,
  SegmentRuleTree,
} from '../services/segment-builder-service';

export const segmentsRouter = Router();
segmentsRouter.use(tenantScope as any);

const ALLOWED = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF];

segmentsRouter.get('/', requireRoles(...ALLOWED) as any, async (req: Request, res: Response): Promise<void> => {
  const segs = await listCustomSegments(req.tenantContext.businessId);
  res.json(segs);
});

segmentsRouter.post('/', requireRoles(...ALLOWED) as any, async (req: Request, res: Response): Promise<void> => {
  const { name, description, rules } = req.body;
  if (!name || !rules) { res.status(400).json({ error: 'name and rules are required' }); return; }
  const seg = await createCustomSegment(req.tenantContext.businessId, name, description ?? null, rules as SegmentRuleTree);
  res.status(201).json(seg);
});

segmentsRouter.put('/:id', requireRoles(...ALLOWED) as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, rules } = req.body;
    const seg = await updateCustomSegment(req.params.id, req.tenantContext.businessId, name, description, rules);
    res.json(seg);
  } catch (err: any) {
    if (err.message === 'CUSTOM_SEGMENT_NOT_FOUND') { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

segmentsRouter.delete('/:id', requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any, async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteCustomSegment(req.params.id, req.tenantContext.businessId);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'CUSTOM_SEGMENT_NOT_FOUND') { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

segmentsRouter.post('/:id/evaluate', requireRoles(...ALLOWED) as any, async (req: Request, res: Response): Promise<void> => {
  const { prisma } = await import('../config/prisma');
  const seg = await (prisma as any).customSegment.findFirst({
    where: { id: req.params.id, businessId: req.tenantContext.businessId },
  });
  if (!seg) { res.status(404).json({ error: 'CUSTOM_SEGMENT_NOT_FOUND' }); return; }
  const ids = await evaluateSegment(req.tenantContext.businessId, seg.rulesJson as SegmentRuleTree);
  res.json({ count: ids.length, customerIds: ids.slice(0, 100) }); // cap preview at 100
});

segmentsRouter.post('/evaluate', requireRoles(...ALLOWED) as any, async (req: Request, res: Response): Promise<void> => {
  const { rules } = req.body;
  if (!rules) { res.status(400).json({ error: 'rules required' }); return; }
  const ids = await evaluateSegment(req.tenantContext.businessId, rules as SegmentRuleTree, 500);
  res.json({ count: ids.length, customerIds: ids.slice(0, 50) });
});
