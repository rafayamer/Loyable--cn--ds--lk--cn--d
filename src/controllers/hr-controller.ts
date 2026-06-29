// ================================================================
//  hr-controller.ts
//  Operations · HR & Staff Management API.
//
//  Submodules:
//    - Employee Directory      (employees, documents, certifications)
//    - Roles & Permissions     (custom_roles)
//    - Staff Onboarding        (employee.onboardingJson checklist)
//    - Training System         (training_modules, training_progress)
//    - Attendance              (attendance_records, clock in/out)
//    - Shift & Leave           (shifts, leave_requests)
//    - Performance             (aggregated from visits per staff)
//    - Employee Rewards        (employee_rewards)
//
//  All routes are tenant-scoped; management is restricted to
//  TENANT_OWNER + BRANCH_MANAGER.
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { requireFeature } from '../services/entitlement-service';

export const hrRouter = Router();
hrRouter.use(tenantScope as any);
// HR & Staff is a Pro feature.
hrRouter.use(requireFeature('hr') as any);

const MANAGE = [Role.TENANT_OWNER, Role.BRANCH_MANAGER];
const bz = (req: Request) => req.tenantContext.businessId;

// Default onboarding checklist seeded onto every new employee.
const DEFAULT_ONBOARDING = [
  { key: 'invite',     label: 'Send invite & temporary credentials', done: false },
  { key: 'profile',    label: 'Complete employee profile',           done: false },
  { key: 'documents',  label: 'Upload required documents',           done: false },
  { key: 'policies',   label: 'Acknowledge company policies',        done: false },
  { key: 'training',   label: 'Complete required training',          done: false },
  { key: 'security',   label: 'Security & access setup',             done: false },
];

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (err) { console.error('[hr]', err); res.status(500).json({ error: 'HR_ERROR', message: (err as Error).message }); }
  };

// ================================================================
// EMPLOYEE DIRECTORY
// ================================================================

hrRouter.get('/employees', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const { status, branchLocationId, q } = req.query as Record<string, string>;
  const where: any = { businessId: bz(req) };
  if (status) where.status = status;
  if (branchLocationId) where.branchLocationId = branchLocationId;
  if (q) where.OR = [
    { fullName: { contains: q, mode: 'insensitive' } },
    { email:    { contains: q, mode: 'insensitive' } },
    { jobTitle: { contains: q, mode: 'insensitive' } },
  ];
  const employees = await prisma.employee.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json({ employees });
}));

hrRouter.post('/employees', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.fullName?.trim()) { res.status(400).json({ error: 'fullName is required' }); return; }
  const employee = await prisma.employee.create({
    data: {
      businessId:            bz(req),
      branchLocationId:      b.branchLocationId ?? null,
      fullName:              String(b.fullName).trim(),
      email:                 b.email ?? null,
      phone:                 b.phone ?? null,
      jobTitle:              b.jobTitle ?? null,
      hrRole:                b.hrRole ?? 'CASHIER',
      customRoleId:          b.customRoleId ?? null,
      employmentType:        b.employmentType ?? 'FULL_TIME',
      status:                b.status ?? 'ONBOARDING',
      hireDate:              b.hireDate ? new Date(b.hireDate) : null,
      dateOfBirth:           b.dateOfBirth ? new Date(b.dateOfBirth) : null,
      address:               b.address ?? null,
      emergencyContactName:  b.emergencyContactName ?? null,
      emergencyContactPhone: b.emergencyContactPhone ?? null,
      notes:                 b.notes ?? null,
      onboardingJson:        DEFAULT_ONBOARDING,
    },
  });
  res.status(201).json({ employee });
}));

hrRouter.get('/employees/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const employee = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!employee) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const [documents, training, rewards, attendance, leave] = await Promise.all([
    prisma.employeeDocument.findMany({ where: { businessId, employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
    prisma.trainingProgress.findMany({ where: { businessId, employeeId: employee.id } }),
    prisma.employeeReward.findMany({ where: { businessId, employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.attendanceRecord.findMany({ where: { businessId, employeeId: employee.id }, orderBy: { clockIn: 'desc' }, take: 20 }),
    prisma.leaveRequest.findMany({ where: { businessId, employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  res.json({ employee, documents, training, rewards, attendance, leave });
}));

hrRouter.put('/employees/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  const data: any = {};
  for (const k of ['fullName','email','phone','jobTitle','hrRole','customRoleId','employmentType','status','address','avatarUrl','emergencyContactName','emergencyContactPhone','notes','branchLocationId']) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if (b.hireDate !== undefined)    data.hireDate    = b.hireDate ? new Date(b.hireDate) : null;
  if (b.dateOfBirth !== undefined) data.dateOfBirth = b.dateOfBirth ? new Date(b.dateOfBirth) : null;
  const employee = await prisma.employee.update({ where: { id: existing.id }, data });
  res.json({ employee });
}));

hrRouter.delete('/employees/:id', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  await prisma.$transaction([
    prisma.employeeDocument.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.trainingProgress.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.attendanceRecord.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.shift.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.leaveRequest.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.employeeReward.deleteMany({ where: { businessId, employeeId: existing.id } }),
    prisma.employee.delete({ where: { id: existing.id } }),
  ]);
  res.json({ ok: true });
}));

// Update a single onboarding checklist item (done/undone) — recompute %.
hrRouter.patch('/employees/:id/onboarding', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { key, done } = req.body ?? {};
  const emp = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!emp) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const checklist = Array.isArray(emp.onboardingJson) ? (emp.onboardingJson as any[]) : DEFAULT_ONBOARDING;
  const next = checklist.map(item => item.key === key ? { ...item, done: !!done, completedAt: done ? new Date().toISOString() : null } : item);
  const allDone = next.every(i => i.done);
  const employee = await prisma.employee.update({
    where: { id: emp.id },
    data: { onboardingJson: next, ...(allDone && emp.status === 'ONBOARDING' ? { status: 'ACTIVE' } : {}) },
  });
  const pct = Math.round((next.filter(i => i.done).length / next.length) * 100);
  res.json({ employee, onboardingPercent: pct });
}));

// ================================================================
// DOCUMENTS & CERTIFICATIONS
// ================================================================

hrRouter.post('/employees/:id/documents', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const emp = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!emp) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  if (!b.name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const doc = await prisma.employeeDocument.create({
    data: {
      businessId, employeeId: emp.id,
      type:      b.type ?? 'OTHER',
      name:      String(b.name).trim(),
      issuer:    b.issuer ?? null,
      fileUrl:   b.fileUrl ?? null,
      issuedAt:  b.issuedAt ? new Date(b.issuedAt) : null,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    },
  });
  res.status(201).json({ document: doc });
}));

hrRouter.delete('/documents/:docId', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.employeeDocument.findFirst({ where: { id: req.params.docId, businessId } });
  if (!existing) { res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' }); return; }
  await prisma.employeeDocument.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// ================================================================
// ROLES & PERMISSIONS
// ================================================================

hrRouter.get('/roles', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const roles = await prisma.customRole.findMany({ where: { businessId: bz(req) }, orderBy: { createdAt: 'asc' } });
  res.json({ roles });
}));

hrRouter.post('/roles', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const role = await prisma.customRole.create({
    data: { businessId: bz(req), name: String(b.name).trim(), description: b.description ?? null, permissionsJson: b.permissions ?? {} },
  });
  res.status(201).json({ role });
}));

hrRouter.put('/roles/:id', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.customRole.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'ROLE_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  const role = await prisma.customRole.update({
    where: { id: existing.id },
    data: { ...(b.name !== undefined && { name: b.name }), ...(b.description !== undefined && { description: b.description }), ...(b.permissions !== undefined && { permissionsJson: b.permissions }) },
  });
  res.json({ role });
}));

hrRouter.delete('/roles/:id', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.customRole.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'ROLE_NOT_FOUND' }); return; }
  await prisma.customRole.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// ================================================================
// TRAINING SYSTEM
// ================================================================

hrRouter.get('/training', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const modules = await prisma.trainingModule.findMany({ where: { businessId: bz(req) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  res.json({ modules });
}));

hrRouter.post('/training', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.title?.trim()) { res.status(400).json({ error: 'title is required' }); return; }
  const module = await prisma.trainingModule.create({
    data: {
      businessId: bz(req),
      title:       String(b.title).trim(),
      description: b.description ?? null,
      type:        b.type ?? 'VIDEO',
      contentUrl:  b.contentUrl ?? null,
      quizJson:    b.quiz ?? undefined,
      passingScore: b.passingScore ?? 70,
      isRequired:  !!b.isRequired,
      sortOrder:   b.sortOrder ?? 0,
    },
  });
  res.status(201).json({ module });
}));

hrRouter.put('/training/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.trainingModule.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'MODULE_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  const data: any = {};
  for (const k of ['title','description','type','contentUrl','passingScore','isRequired','sortOrder','isActive']) if (b[k] !== undefined) data[k] = b[k];
  if (b.quiz !== undefined) data.quizJson = b.quiz;
  const module = await prisma.trainingModule.update({ where: { id: existing.id }, data });
  res.json({ module });
}));

hrRouter.delete('/training/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.trainingModule.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'MODULE_NOT_FOUND' }); return; }
  await prisma.$transaction([
    prisma.trainingProgress.deleteMany({ where: { businessId, moduleId: existing.id } }),
    prisma.trainingModule.delete({ where: { id: existing.id } }),
  ]);
  res.json({ ok: true });
}));

// Record / upsert an employee's progress on a module.
hrRouter.post('/training/:moduleId/progress', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { employeeId, status, score } = req.body ?? {};
  if (!employeeId) { res.status(400).json({ error: 'employeeId is required' }); return; }
  const mod = await prisma.trainingModule.findFirst({ where: { id: req.params.moduleId, businessId } });
  if (!mod) { res.status(404).json({ error: 'MODULE_NOT_FOUND' }); return; }
  const passed = score != null ? Number(score) >= mod.passingScore : status === 'COMPLETED';
  const finalStatus = status ?? (score != null ? (passed ? 'COMPLETED' : 'FAILED') : 'IN_PROGRESS');
  const progress = await prisma.trainingProgress.upsert({
    where:  { employeeId_moduleId: { employeeId, moduleId: mod.id } },
    update: { status: finalStatus, score: score ?? null, completedAt: finalStatus === 'COMPLETED' ? new Date() : null },
    create: { businessId, employeeId, moduleId: mod.id, status: finalStatus, score: score ?? null, completedAt: finalStatus === 'COMPLETED' ? new Date() : null },
  });
  res.json({ progress });
}));

// ================================================================
// ATTENDANCE
// ================================================================

hrRouter.get('/attendance', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { employeeId, from, to } = req.query as Record<string, string>;
  const where: any = { businessId };
  if (employeeId) where.employeeId = employeeId;
  if (from || to) where.clockIn = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
  const records = await prisma.attendanceRecord.findMany({ where, orderBy: { clockIn: 'desc' }, take: 200 });
  res.json({ records });
}));

hrRouter.post('/attendance/clock-in', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const b = req.body ?? {};
  if (!b.employeeId) { res.status(400).json({ error: 'employeeId is required' }); return; }
  // Prevent a double clock-in: an open record (no clockOut) blocks a new one.
  const open = await prisma.attendanceRecord.findFirst({ where: { businessId, employeeId: b.employeeId, clockOut: null } });
  if (open) { res.status(409).json({ error: 'ALREADY_CLOCKED_IN', record: open }); return; }
  const record = await prisma.attendanceRecord.create({
    data: {
      businessId, employeeId: b.employeeId,
      branchLocationId: b.branchLocationId ?? null,
      clockIn: new Date(),
      method:  b.method ?? 'WEB',
      latitude: b.latitude ?? null, longitude: b.longitude ?? null,
    },
  });
  res.status(201).json({ record });
}));

hrRouter.post('/attendance/:id/clock-out', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.attendanceRecord.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'RECORD_NOT_FOUND' }); return; }
  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data:  { clockOut: new Date(), breakMinutes: req.body?.breakMinutes ?? existing.breakMinutes },
  });
  res.json({ record });
}));

// ================================================================
// SHIFTS (ROTA)
// ================================================================

hrRouter.get('/shifts', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { employeeId, from, to } = req.query as Record<string, string>;
  const where: any = { businessId };
  if (employeeId) where.employeeId = employeeId;
  if (from || to) where.startsAt = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
  const shifts = await prisma.shift.findMany({ where, orderBy: { startsAt: 'asc' }, take: 500 });
  res.json({ shifts });
}));

hrRouter.post('/shifts', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.employeeId || !b.startsAt || !b.endsAt) { res.status(400).json({ error: 'employeeId, startsAt, endsAt are required' }); return; }
  const shift = await prisma.shift.create({
    data: {
      businessId: bz(req), employeeId: b.employeeId,
      branchLocationId: b.branchLocationId ?? null,
      startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt),
      role: b.role ?? null, status: b.status ?? 'SCHEDULED', notes: b.notes ?? null,
    },
  });
  res.status(201).json({ shift });
}));

hrRouter.put('/shifts/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.shift.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'SHIFT_NOT_FOUND' }); return; }
  const b = req.body ?? {};
  const data: any = {};
  for (const k of ['role','status','notes','branchLocationId','employeeId']) if (b[k] !== undefined) data[k] = b[k];
  if (b.startsAt !== undefined) data.startsAt = new Date(b.startsAt);
  if (b.endsAt !== undefined)   data.endsAt   = new Date(b.endsAt);
  const shift = await prisma.shift.update({ where: { id: existing.id }, data });
  res.json({ shift });
}));

hrRouter.delete('/shifts/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.shift.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'SHIFT_NOT_FOUND' }); return; }
  await prisma.shift.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// ================================================================
// LEAVE REQUESTS
// ================================================================

hrRouter.get('/leave', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { status, employeeId } = req.query as Record<string, string>;
  const where: any = { businessId };
  if (status) where.status = status;
  if (employeeId) where.employeeId = employeeId;
  const requests = await prisma.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ requests });
}));

hrRouter.post('/leave', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.employeeId || !b.startDate || !b.endDate) { res.status(400).json({ error: 'employeeId, startDate, endDate are required' }); return; }
  const request = await prisma.leaveRequest.create({
    data: {
      businessId: bz(req), employeeId: b.employeeId,
      type: b.type ?? 'ANNUAL', startDate: new Date(b.startDate), endDate: new Date(b.endDate),
      reason: b.reason ?? null, status: 'PENDING',
    },
  });
  res.status(201).json({ request });
}));

hrRouter.post('/leave/:id/decision', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { decision } = req.body ?? {};
  if (!['APPROVED', 'REJECTED'].includes(decision)) { res.status(400).json({ error: 'decision must be APPROVED or REJECTED' }); return; }
  const existing = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'LEAVE_NOT_FOUND' }); return; }
  const request = await prisma.leaveRequest.update({
    where: { id: existing.id },
    data:  { status: decision, approverId: req.tenantContext.userId, decidedAt: new Date() },
  });
  res.json({ request });
}));

hrRouter.delete('/leave/:id', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const existing = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'LEAVE_NOT_FOUND' }); return; }
  await prisma.leaveRequest.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// ================================================================
// PERFORMANCE — revenue & visits attributed to each staff member
// ================================================================

hrRouter.get('/performance', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { from, to } = req.query as Record<string, string>;
  const since = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
  const until = to ? new Date(to) : new Date();

  const employees = await prisma.employee.findMany({ where: { businessId }, select: { id: true, fullName: true, jobTitle: true, userId: true } });

  // Visits carry staffId (a User id). Aggregate revenue + visit count per staff user.
  const visitAgg = await prisma.visit.groupBy({
    by:    ['staffId'],
    where: { businessId, visitedAt: { gte: since, lte: until }, staffId: { not: null } },
    _sum:  { amountSpent: true },
    _count:{ id: true },
  });
  const byUser = new Map<string, { revenue: number; visits: number }>();
  for (const v of visitAgg) if (v.staffId) byUser.set(v.staffId, { revenue: Number(v._sum.amountSpent ?? 0), visits: v._count.id });

  // Reward points earned in the window, per employee.
  const rewardAgg = await prisma.employeeReward.groupBy({
    by:    ['employeeId'],
    where: { businessId, status: 'APPROVED', createdAt: { gte: since, lte: until } },
    _sum:  { points: true },
  });
  const rewardByEmp = new Map<string, number>();
  for (const r of rewardAgg) rewardByEmp.set(r.employeeId, Number(r._sum.points ?? 0));

  const rows = employees.map(e => {
    const perf = e.userId ? byUser.get(e.userId) : undefined;
    return {
      employeeId:   e.id,
      fullName:     e.fullName,
      jobTitle:     e.jobTitle,
      revenue:      Number((perf?.revenue ?? 0).toFixed(2)),
      visits:       perf?.visits ?? 0,
      rewardPoints: rewardByEmp.get(e.id) ?? 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  res.json({ from: since, to: until, rows });
}));

// ================================================================
// EMPLOYEE REWARDS
// ================================================================

hrRouter.get('/rewards', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { employeeId } = req.query as Record<string, string>;
  const where: any = { businessId };
  if (employeeId) where.employeeId = employeeId;
  const rewards = await prisma.employeeReward.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ rewards });
}));

hrRouter.post('/rewards', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!b.employeeId) { res.status(400).json({ error: 'employeeId is required' }); return; }
  const reward = await prisma.employeeReward.create({
    data: {
      businessId: bz(req), employeeId: b.employeeId,
      type: b.type ?? 'POINTS', points: b.points ?? 0,
      amount: b.amount != null ? b.amount : null, note: b.note ?? null,
      status: b.status ?? 'APPROVED', grantedBy: req.tenantContext.userId,
    },
  });
  res.status(201).json({ reward });
}));

hrRouter.post('/rewards/:id/decision', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { decision } = req.body ?? {};
  if (!['APPROVED', 'REJECTED'].includes(decision)) { res.status(400).json({ error: 'decision must be APPROVED or REJECTED' }); return; }
  const existing = await prisma.employeeReward.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'REWARD_NOT_FOUND' }); return; }
  const reward = await prisma.employeeReward.update({ where: { id: existing.id }, data: { status: decision } });
  res.json({ reward });
}));

// ================================================================
// HR SUMMARY (dashboard counts)
// ================================================================

hrRouter.get('/summary', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const [total, active, onboarding, pendingLeave, openShiftsToday] = await Promise.all([
    prisma.employee.count({ where: { businessId } }),
    prisma.employee.count({ where: { businessId, status: 'ACTIVE' } }),
    prisma.employee.count({ where: { businessId, status: 'ONBOARDING' } }),
    prisma.leaveRequest.count({ where: { businessId, status: 'PENDING' } }),
    prisma.shift.count({ where: { businessId, startsAt: { gte: new Date(new Date().setHours(0,0,0,0)) , lte: new Date(new Date().setHours(23,59,59,999)) } } }),
  ]);
  res.json({ total, active, onboarding, pendingLeave, shiftsToday: openShiftsToday });
}));
