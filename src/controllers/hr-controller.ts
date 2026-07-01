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
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { requireFeature } from '../services/entitlement-service';
import { compressUnder } from '../utils/image-compress.util';
import { inviteStaff, createStaffLoginForEmployee } from '../services/auth-service';
import { sendEmail } from '../utils/email.util';

export const hrRouter = Router();
hrRouter.use(tenantScope as any);
// HR & Staff is a Pro feature.
hrRouter.use(requireFeature('hr') as any);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// In-memory so we can compress before writing to disk. Hard cap 15MB intake
// (images get compressed under 1MB; PDFs must already be under 1MB).
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const DOC_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

// Map the HR role label → an invitable platform Role for login provisioning.
const HR_ROLE_TO_PLATFORM: Record<string, Role> = {
  MANAGER:   Role.BRANCH_MANAGER,
  MARKETING: Role.MARKETING_STAFF,
  CASHIER:   Role.CASHIER,
  SUPPORT:   Role.CASHIER,
  CUSTOM:    Role.CASHIER,
  // OWNER is intentionally absent — owners aren't invited via this flow.
};

const MANAGE = [Role.TENANT_OWNER, Role.BRANCH_MANAGER];
// Self-service ("me") endpoints are open to every authenticated staff role so a
// team member can clock in/out and apply for leave against their own record.
const ANY_STAFF = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF, Role.CASHIER];
const bz = (req: Request) => req.tenantContext.businessId;

// Great-circle distance between two lat/long points, in metres.
const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371000; const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat); const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
// Staff must clock in within the business location. Honour the owner's configured
// radius but never allow more than 20 m, per requirement.
const clockInRadius = (configured?: number | null) => Math.min(configured ?? 20, 20);

// Paid annual-leave allotment per employee per calendar year. Once used up, any
// further ANNUAL leave is automatically downgraded to UNPAID.
const ANNUAL_LEAVE_DAYS = 20;
const daysBetween = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
// Returns the leave type to actually store: keeps SICK/EMERGENCY/UNPAID as-is,
// but converts ANNUAL to UNPAID when the employee has no paid days left this year.
const resolveLeaveType = async (businessId: string, employeeId: string, requestedType: string, start: Date, end: Date): Promise<{ type: string; autoUnpaid: boolean }> => {
  const type = requestedType || 'ANNUAL';
  if (type !== 'ANNUAL') return { type, autoUnpaid: false };
  const yearStart = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(start.getUTCFullYear(), 11, 31, 23, 59, 59));
  const existing = await prisma.leaveRequest.findMany({
    where: { businessId, employeeId, type: 'ANNUAL', status: { in: ['PENDING', 'APPROVED'] }, startDate: { gte: yearStart, lte: yearEnd } },
    select: { startDate: true, endDate: true },
  });
  const usedDays = existing.reduce((t, l) => t + daysBetween(l.startDate, l.endDate), 0);
  const requestDays = daysBetween(start, end);
  // If this request pushes them past their paid allotment, it becomes unpaid.
  if (usedDays + requestDays > ANNUAL_LEAVE_DAYS) return { type: 'UNPAID', autoUnpaid: true };
  return { type: 'ANNUAL', autoUnpaid: false };
};

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

// Flip one onboarding checklist item to done (used when a login invite is sent).
const markOnboarding = (current: unknown, key: string): any => {
  const list = Array.isArray(current) ? (current as any[]) : DEFAULT_ONBOARDING;
  return list.map(i => i.key === key ? { ...i, done: true, completedAt: new Date().toISOString() } : i);
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
  // Data is preserved by default. A hard delete must be explicitly confirmed
  // (?confirm=true); otherwise we refuse and point to suspend/terminate.
  if (req.query.confirm !== 'true') {
    res.status(409).json({ error: 'CONFIRM_REQUIRED', message: 'Employee records are kept by default. Suspend or terminate instead, or pass confirm=true to permanently delete.' });
    return;
  }
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
  // Best-effort remove the stored file, then the record.
  if (existing.fileUrl?.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(existing.fileUrl))); } catch { /* ignore */ }
  }
  await prisma.employeeDocument.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// Upload an actual file for an employee document. Images are compressed under
// 1MB (resolution preserved); PDFs must already be under 1MB.
hrRouter.post('/employees/:id/documents/upload', requireRoles(...MANAGE) as any, memUpload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = bz(req);
      const emp = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
      if (!emp) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
      if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!DOC_EXTS.includes(ext)) { res.status(400).json({ error: 'Only JPG, PNG, WebP or PDF files are allowed' }); return; }

      let result;
      try { result = await compressUnder(req.file.buffer, ext, 1024 * 1024); }
      catch (e) { res.status(413).json({ error: (e as Error).message.replace('FILE_TOO_LARGE: ', '') }); return; }

      const filename = `hrdoc-${Date.now()}-${Math.random().toString(36).slice(2)}${result.ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), result.buffer);

      const doc = await prisma.employeeDocument.create({
        data: {
          businessId, employeeId: emp.id,
          type: (req.body?.type as string) || 'OTHER',
          name: (req.body?.name as string)?.trim() || req.file.originalname,
          issuer: req.body?.issuer || null,
          fileUrl: `/uploads/${filename}`,
          issuedAt: req.body?.issuedAt ? new Date(req.body.issuedAt) : null,
          expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : null,
        },
      });
      res.status(201).json({ document: doc, compressed: result.compressed, sizeKB: Math.round(result.bytes / 1024) });
    } catch (err) {
      console.error('[hr:upload]', (err as Error).message);
      res.status(500).json({ error: 'UPLOAD_FAILED' });
    }
  });

// Send a login invite (email with credentials link) to an employee. Maps the
// HR role to a platform role; the invited person only ever sees their role's
// screens once they accept. Owners can't be invited via this flow.
hrRouter.post('/employees/:id/invite', requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any, wrap(async (req, res) => {
  const { businessId, userId } = req.tenantContext;
  const emp = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!emp) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  if (!emp.email) { res.status(400).json({ error: 'EMPLOYEE_HAS_NO_EMAIL' }); return; }
  const platformRole = HR_ROLE_TO_PLATFORM[emp.hrRole];
  if (!platformRole) { res.status(400).json({ error: 'ROLE_NOT_INVITABLE', message: `The ${emp.hrRole} role can't be issued a login here.` }); return; }
  try {
    await inviteStaff({ inviterUserId: userId, businessId, email: emp.email, role: platformRole, branchLocationId: emp.branchLocationId ?? undefined });
    await prisma.employee.update({ where: { id: emp.id }, data: { onboardingJson: markOnboarding(emp.onboardingJson, 'invite') } });
    res.json({ ok: true, invitedEmail: emp.email, role: platformRole });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'USER_ALREADY_EXISTS_IN_BUSINESS') { res.status(409).json({ error: 'ALREADY_HAS_LOGIN' }); return; }
    res.status(400).json({ error: msg });
  }
}));

// Quick status change: suspend / terminate / reactivate. Data is preserved —
// this only flips status; records are never deleted here.
hrRouter.post('/employees/:id/status', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const status = String(req.body?.status ?? '');
  if (!['ACTIVE', 'SUSPENDED', 'TERMINATED', 'ONBOARDING'].includes(status)) { res.status(400).json({ error: 'INVALID_STATUS' }); return; }
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!existing) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const employee = await prisma.employee.update({ where: { id: existing.id }, data: { status } });
  await prisma.auditLog.create({ data: { businessId, userId: req.tenantContext.userId, action: 'EMPLOYEE_STATUS_CHANGE', entityType: 'Employee', entityId: existing.id, metaJson: { from: existing.status, to: status } } }).catch(() => {});

  // On termination/suspension, revoke the linked login so they can no longer
  // access the system; on re-activation, restore it. TERMINATED also emails them.
  if (existing.userId) {
    if (status === 'TERMINATED' || status === 'SUSPENDED') {
      await prisma.user.update({ where: { id: existing.userId }, data: { isActive: false } }).catch(() => {});
      await prisma.userSession.deleteMany({ where: { userId: existing.userId } }).catch(() => {});
    } else if (status === 'ACTIVE') {
      await prisma.user.update({ where: { id: existing.userId }, data: { isActive: true } }).catch(() => {});
    }
  }
  if (status === 'TERMINATED' && employee.email) {
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
    await sendEmail({
      to: employee.email.toLowerCase().trim(),
      subject: `Your access to ${biz?.name ?? 'the team'} has ended`,
      templateId: 'STAFF_TERMINATED',
      variables: { name: employee.fullName, businessName: biz?.name ?? '' },
    }).catch((e: unknown) => console.warn('[hr] termination email failed (non-fatal):', (e as Error).message));
  }
  res.json({ employee });
}));

// Create a login (owner-set password) for an existing employee — HR module.
hrRouter.post('/employees/:id/create-login', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const emp = await prisma.employee.findFirst({ where: { id: req.params.id, businessId } });
  if (!emp) { res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' }); return; }
  const roleStr = String(req.body?.role ?? emp.hrRole ?? 'MARKETING');
  // Accept either a platform Role (BRANCH_MANAGER/…) or an HR label (MANAGER/…).
  const asPlatform = (Object.values(Role) as string[]).includes(roleStr) ? (roleStr as Role) : undefined;
  const role = asPlatform ?? HR_ROLE_TO_PLATFORM[roleStr] ?? Role.MARKETING_STAFF;
  try {
    const result = await createStaffLoginForEmployee({ inviterUserId: req.tenantContext.userId, businessId, employeeId: emp.id, role, password: String(req.body?.password ?? '') });
    res.status(201).json(result);
  } catch (e: any) {
    const msg = e?.message ?? 'CREATE_LOGIN_FAILED';
    const code = msg === 'ALREADY_HAS_LOGIN' ? 409 : msg === 'PASSWORD_TOO_SHORT' ? 400 : 400;
    res.status(code).json({ error: msg });
  }
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
  const start = new Date(b.startDate); const end = new Date(b.endDate);
  const { type, autoUnpaid } = await resolveLeaveType(bz(req), b.employeeId, b.type ?? 'ANNUAL', start, end);
  const request = await prisma.leaveRequest.create({
    data: {
      businessId: bz(req), employeeId: b.employeeId,
      type, startDate: start, endDate: end,
      reason: b.reason ?? null, status: 'PENDING',
    },
  });
  res.status(201).json({ request, autoUnpaid });
}));

hrRouter.post('/leave/:id/decision', requireRoles(...MANAGE) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const { decision } = req.body ?? {};
  // CANCELLED = the owner revokes an already-approved leave.
  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(decision)) { res.status(400).json({ error: 'decision must be APPROVED, REJECTED or CANCELLED' }); return; }
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
// SELF-SERVICE ("me") — for the logged-in staff member / manager
//   - GET  /hr/me                 → own employee record + open shift/attendance
//   - POST /hr/me/clock-in        → GPS-validated clock-in (within 20 m)
//   - POST /hr/me/clock-out       → close own open attendance record
//   - POST /hr/me/leave           → apply for leave for oneself
// ================================================================

const findMyEmployee = async (req: Request) =>
  prisma.employee.findFirst({ where: { businessId: bz(req), userId: req.tenantContext.userId } });

hrRouter.get('/me', requireRoles(...ANY_STAFF) as any, wrap(async (req, res) => {
  const employee = await findMyEmployee(req);
  if (!employee) { res.json({ employee: null, openAttendance: null }); return; }
  const openAttendance = await prisma.attendanceRecord.findFirst({ where: { businessId: bz(req), employeeId: employee.id, clockOut: null } });
  const recent = await prisma.attendanceRecord.findMany({ where: { businessId: bz(req), employeeId: employee.id }, orderBy: { clockIn: 'desc' }, take: 10 });
  const leave = await prisma.leaveRequest.findMany({ where: { businessId: bz(req), employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  // The employee's own shift plan (last 7 days → next ~60) so they can see their rota.
  const from = new Date(); from.setDate(from.getDate() - 7);
  const to = new Date(); to.setDate(to.getDate() + 60);
  const shifts = await prisma.shift.findMany({ where: { businessId: bz(req), employeeId: employee.id, startsAt: { gte: from, lte: to } }, orderBy: { startsAt: 'asc' } });
  res.json({ employee, openAttendance, recent, leave, shifts });
}));

hrRouter.post('/me/clock-in', requireRoles(...ANY_STAFF) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const employee = await findMyEmployee(req);
  if (!employee) { res.status(404).json({ error: 'NO_STAFF_RECORD' }); return; }
  const open = await prisma.attendanceRecord.findFirst({ where: { businessId, employeeId: employee.id, clockOut: null } });
  if (open) { res.status(409).json({ error: 'ALREADY_CLOCKED_IN', record: open }); return; }
  const { latitude, longitude } = req.body ?? {};
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { latitude: true, longitude: true, checkInRadiusMeters: true } });
  // Enforce GPS proximity only when the business has set its location.
  if (biz?.latitude != null && biz?.longitude != null) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') { res.status(400).json({ error: 'LOCATION_REQUIRED' }); return; }
    const dist = distanceMeters(latitude, longitude, biz.latitude, biz.longitude);
    const allowed = clockInRadius(biz.checkInRadiusMeters);
    if (dist > allowed) { res.status(403).json({ error: 'OUT_OF_RANGE', distance: Math.round(dist), allowed }); return; }
  }
  const record = await prisma.attendanceRecord.create({
    data: { businessId, employeeId: employee.id, clockIn: new Date(), method: 'GPS', latitude: latitude ?? null, longitude: longitude ?? null },
  });
  res.status(201).json({ record });
}));

hrRouter.post('/me/clock-out', requireRoles(...ANY_STAFF) as any, wrap(async (req, res) => {
  const businessId = bz(req);
  const employee = await findMyEmployee(req);
  if (!employee) { res.status(404).json({ error: 'NO_STAFF_RECORD' }); return; }
  const open = await prisma.attendanceRecord.findFirst({ where: { businessId, employeeId: employee.id, clockOut: null } });
  if (!open) { res.status(404).json({ error: 'NOT_CLOCKED_IN' }); return; }
  const record = await prisma.attendanceRecord.update({ where: { id: open.id }, data: { clockOut: new Date() } });
  res.json({ record });
}));

hrRouter.post('/me/leave', requireRoles(...ANY_STAFF) as any, wrap(async (req, res) => {
  const employee = await findMyEmployee(req);
  if (!employee) { res.status(404).json({ error: 'NO_STAFF_RECORD' }); return; }
  const b = req.body ?? {};
  if (!b.startDate || !b.endDate) { res.status(400).json({ error: 'startDate and endDate are required' }); return; }
  const start = new Date(b.startDate); const end = new Date(b.endDate);
  const { type, autoUnpaid } = await resolveLeaveType(bz(req), employee.id, b.type ?? 'ANNUAL', start, end);
  const request = await prisma.leaveRequest.create({
    data: {
      businessId: bz(req), employeeId: employee.id,
      type, startDate: start, endDate: end,
      reason: b.reason ?? null, status: 'PENDING',
    },
  });
  res.status(201).json({ request, autoUnpaid });
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
