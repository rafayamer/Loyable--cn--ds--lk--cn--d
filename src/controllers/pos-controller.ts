// ================================================================
//  POS Controller — Manual sale entry + FBR e-invoicing
//  REST endpoints for the CRM frontend POS page
// ================================================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope } from '../middleware/tenant-scope-middleware';
import {
  submitInvoice,
  submitFBRInvoice,
  generateInvoiceNumber,
  calculateGST,
  buildFBRInvoice,
  SaleItem,
} from '../services/fbr-service';
import { accruePointsForVisit } from '../services/loyalty-service';

/** Normalise any phone number format to E.164. Defaults to +44 (UK). */
function normalisePhone(raw: string): string {
  const digits = raw.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+'))  return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('0'))  return '+44' + digits.slice(1);
  if (digits.length === 10)    return '+44' + digits;
  if (digits.length === 11 && !digits.startsWith('+')) return '+' + digits;
  return digits.startsWith('+') ? digits : '+' + digits;
}

export const posRouter = Router();

// All POS routes require a valid tenant JWT
posRouter.use(tenantScope);

// ── Helper: get authenticated business ID from middleware context ──
function getBizId(req: Request): string {
  return (req as any).tenantContext?.businessId as string;
}

// ── GET /api/pos/stats ────────────────────────────────────────────
posRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const visits = await prisma.visit.findMany({
      where: {
        businessId,
        source: { in: ['POS_SALE', 'MANUAL'] },
        visitedAt: { gte: today, lt: tomorrow },
      },
      select: {
        amountSpent:     true,
        gstAmount:       true,
        fbrInvoiceNumber: true,
        fbrSubmittedAt:  true,
      },
    });

    const totalSales        = visits.reduce((s, v) => s + Number(v.amountSpent ?? 0), 0);
    const totalGst          = visits.reduce((s, v) => s + Number(v.gstAmount ?? 0), 0);
    const transactionCount  = visits.length;
    const fbrSubmitted      = visits.filter(v => v.fbrSubmittedAt).length;
    const fbrFailed         = visits.filter(v => !v.fbrSubmittedAt).length;

    res.json({
      totalSales:       parseFloat(totalSales.toFixed(2)),
      totalGst:         parseFloat(totalGst.toFixed(2)),
      transactionCount,
      fbrSubmitted,
      fbrFailed,
    });
  } catch (err) {
    console.error('[pos] stats error', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/pos/sales ────────────────────────────────────────────
posRouter.get('/sales', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const page  = parseInt(String(req.query.page  ?? 1), 10);
    const limit = parseInt(String(req.query.limit ?? 20), 10);
    const skip  = (page - 1) * limit;

    const where: Prisma.VisitWhereInput = {
      businessId,
      source: { in: ['POS_SALE', 'MANUAL', 'POS_WEBHOOK'] },
    };

    if (req.query.from) {
      (where.visitedAt as any) = {
        ...((where.visitedAt as any) ?? {}),
        gte: new Date(String(req.query.from)),
      };
    }
    if (req.query.to) {
      (where.visitedAt as any) = {
        ...((where.visitedAt as any) ?? {}),
        lte: new Date(String(req.query.to)),
      };
    }
    if (req.query.paymentMode) {
      where.paymentMode = String(req.query.paymentMode);
    }

    const [total, visits] = await Promise.all([
      prisma.visit.count({ where }),
      prisma.visit.findMany({
        where,
        orderBy: { visitedAt: 'desc' },
        skip,
        take: limit,
        include: {
          customer: { select: { fullName: true, whatsappNumber: true, email: true } },
          branch:   { select: { name: true } },
        },
      }),
    ]);

    res.json({ sales: visits, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[pos] sales list error', err);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// ── GET /api/pos/sale/:id ─────────────────────────────────────────
posRouter.get('/sale/:id', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const visit = await prisma.visit.findFirst({
      where: { id: req.params.id, businessId },
      include: {
        customer: true,
        branch:   true,
      },
    });
    if (!visit) return res.status(404).json({ error: 'Sale not found' });
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// ── POST /api/pos/sale ────────────────────────────────────────────
posRouter.post('/sale', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);

    const {
      customerPhone,
      customerName,
      items,
      paymentMode = 'CASH',
      discount    = 0,
      branchLocationId,
    } = req.body as {
      customerPhone?:    string;
      customerName?:     string;
      items:             SaleItem[];
      paymentMode:       'CASH' | 'CARD' | 'WALLET';
      discount?:         number;
      branchLocationId?: string;
    };

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Fetch business FBR settings (new + legacy fields)
    const business = await (prisma.business as any).findUnique({
      where: { id: businessId },
      select: {
        country:     true,
        fbrEnabled:  true,
        fbrPosId:    true,
        fbrToken:    true,
        fbrUserId:   true,
        fbrPassword: true,
        fbrSandbox:  true,
        gstRate:     true,
        ntn:         true,
        strn:        true,
        taxNumber:   true,
      },
    });

    const isPK    = (business?.country ?? '').toUpperCase() === 'PK';
    const gstRate = business?.gstRate ?? 17;
    const taxNumber = business?.taxNumber ?? business?.strn ?? null;

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const { tax: gstAmount, taxable } = calculateGST(subtotal - discount, gstRate);
    const totalAmount = subtotal - discount;

    // Find or create customer
    let customerId: string | null = null;
    if (customerPhone) {
      const normalizedPhone = normalisePhone(customerPhone);

      let customer = await prisma.customer.findFirst({
        where: {
          businessId,
          OR: [
            { whatsappNumber: normalizedPhone },
            { whatsappNumber: customerPhone.trim() },
          ],
        },
      });

      if (!customer && customerName) {
        customer = await prisma.customer.create({
          data: {
            businessId,
            fullName:                 customerName,
            whatsappNumber:           normalizedPhone,
            segment:                  'NEW',
            marketingConsentWhatsapp: true,  // POS opt-in at counter
          },
        });
      }

      customerId = customer?.id ?? null;
    }

    // Require a customer (create anonymous if none)
    if (!customerId) {
      const anonName = customerName || 'Walk-in Customer';
      const anon = await prisma.customer.create({
        data: {
          businessId,
          fullName:                 anonName,
          segment:                  'NEW',
          marketingConsentWhatsapp: true,
        },
      });
      customerId = anon.id;
    }

    const transactionId = `POS-${businessId.slice(-6)}-${Date.now()}`;
    const usin = generateInvoiceNumber(businessId, transactionId);

    // Submit to FBR — ONLY when business country is Pakistan.
    // In sandbox we still produce a printable invoice number (SB-...).
    let fbrInvoiceNumber: string | undefined;
    let fbrQrCode: string | undefined;
    let fbrSubmittedAt: Date | undefined;

    if (isPK && business?.fbrEnabled) {
      try {
        const posId   = String(business?.fbrPosId ?? process.env.FBR_POS_ID ?? '1');
        const sandbox = business?.fbrSandbox !== false; // default to sandbox
        const fbrInvoice = buildFBRInvoice({
          usin, posId: parseInt(posId, 10) || 1, items, paymentMode, discount, gstRate,
          buyerName: customerName, buyerPhone: customerPhone,
        });

        if (business?.fbrUserId && business?.fbrPassword) {
          // New IMSP Basic-Auth flow (handles sandbox fallback internally)
          const result = await submitFBRInvoice(
            { posId, userId: business.fbrUserId, password: business.fbrPassword, ntn: business?.ntn ?? '', taxNumber: taxNumber ?? undefined, sandbox },
            fbrInvoice,
          );
          fbrInvoiceNumber = result.fbrInvoiceNumber || (sandbox ? `SB-${posId}-${usin}` : undefined);
          fbrQrCode        = result.qrCode;
          fbrSubmittedAt   = result.success ? new Date() : undefined;
        } else if (sandbox) {
          // Sandbox without full creds — still print a sandbox number
          fbrInvoiceNumber = `SB-${posId}-${usin}`;
          fbrSubmittedAt   = new Date();
        }
      } catch (fbrErr) {
        console.error('[pos] FBR submission failed:', fbrErr);
        // Never block the sale — if sandbox, still print a number
        if (business?.fbrSandbox !== false) {
          fbrInvoiceNumber = `SB-${business?.fbrPosId ?? 1}-${usin}`;
          fbrSubmittedAt   = new Date();
        }
      }
    }

    // Create Visit record
    const visit = await prisma.visit.create({
      data: {
        businessId,
        customerId,
        branchLocationId: branchLocationId ?? undefined,
        transactionId,
        amountSpent:      new Prisma.Decimal(totalAmount.toFixed(2)),
        source:           'POS_SALE',
        paymentMode,
        gstAmount:        new Prisma.Decimal(gstAmount.toFixed(2)),
        fbrInvoiceNumber,
        fbrQrCode,
        fbrSubmittedAt,
        notes:            `Items: ${items.map(i => `${i.name} x${i.qty}`).join(', ')}`,
      },
      include: {
        customer: { select: { fullName: true, whatsappNumber: true } },
      },
    });

    // Update customer spend metrics
    await prisma.customer.update({
      where:  { id: customerId },
      data:   {
        visitCount:  { increment: 1 },
        totalSpend:  { increment: new Prisma.Decimal(totalAmount.toFixed(2)) },
        lastVisitAt: new Date(),
      },
      select: { id: true },
    });

    // Accrue loyalty points for this visit
    let pointsEarned = 0;
    let pointsBalance = 0;
    try {
      const pts = await accruePointsForVisit(visit.id, businessId, customerId, totalAmount);
      pointsEarned  = pts.pointsEarned;
      pointsBalance = pts.newBalance;
    } catch (ptsErr) {
      console.error('[pos] points accrual failed (non-fatal):', ptsErr);
    }

    res.status(201).json({
      visit,
      fbrInvoiceNumber,
      fbrQrCode,
      gstAmount,
      totalAmount,
      transactionId,
      pointsEarned,
      pointsBalance,
      // Receipt fields — frontend prints these when isPK
      isPK,
      ntn:       business?.ntn ?? null,
      taxNumber,
      gstRate,
    });
  } catch (err) {
    console.error('[pos] create sale error', err);
    res.status(500).json({ error: 'Failed to process sale' });
  }
});

// ── POST /api/pos/sale/:id/fbr-retry ─────────────────────────────
posRouter.post('/sale/:id/fbr-retry', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);

    const visit = await prisma.visit.findFirst({
      where:   { id: req.params.id, businessId },
      include: { customer: true },
    });
    if (!visit) return res.status(404).json({ error: 'Sale not found' });

    const business = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { fbrPosId: true, fbrToken: true, gstRate: true },
    });

    const posId = business?.fbrPosId ?? parseInt(process.env.FBR_POS_ID ?? '1', 10);
    const token = business?.fbrToken ?? process.env.FBR_TOKEN ?? 'sandbox-token';

    const usin = visit.fbrInvoiceNumber
      ? visit.fbrInvoiceNumber
      : generateInvoiceNumber(businessId, visit.transactionId ?? visit.id);

    // Build a minimal single-item invoice from stored data
    const fbrInvoice = buildFBRInvoice({
      usin,
      posId,
      items: [{
        name:      'Sale',
        qty:       1,
        unitPrice: Number(visit.amountSpent),
      }],
      paymentMode: (visit.paymentMode as 'CASH' | 'CARD' | 'WALLET') ?? 'CASH',
      gstRate:     business?.gstRate ?? 17,
      buyerName:   visit.customer?.fullName,
      buyerPhone:  visit.customer?.whatsappNumber ?? undefined,
    });

    const result = await submitInvoice(fbrInvoice, posId, token);

    await prisma.visit.update({
      where: { id: visit.id },
      data:  {
        fbrInvoiceNumber: result.invoiceNumber,
        fbrQrCode:        result.qrCode,
        fbrSubmittedAt:   new Date(),
      },
    });

    res.json({ success: true, invoiceNumber: result.invoiceNumber, qrCode: result.qrCode });
  } catch (err) {
    console.error('[pos] fbr-retry error', err);
    res.status(500).json({ error: 'FBR retry failed' });
  }
});

// ── GET /api/pos/receipt/:id ──────────────────────────────────────
posRouter.get('/receipt/:id', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);

    const visit = await prisma.visit.findFirst({
      where:   { id: req.params.id, businessId },
      include: {
        customer: { select: { fullName: true, whatsappNumber: true, email: true } },
        branch:   { select: { name: true, address: true } },
      },
    });
    if (!visit) return res.status(404).json({ error: 'Sale not found' });

    const business = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { name: true, ntn: true, strn: true, currency: true, logoUrl: true },
    });

    const gst       = Number(visit.gstAmount ?? 0);
    const total     = Number(visit.amountSpent ?? 0);
    const subtotal  = total - gst;
    const date      = new Date(visit.visitedAt).toLocaleString('en-PK');
    const qrUrl     = visit.fbrQrCode ?? '';
    const invoiceNo = visit.fbrInvoiceNumber ?? 'PENDING';

    const curr = business?.currency ?? 'GBP';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Receipt — ${invoiceNo}</title>
<style>
  body{font-family:monospace;max-width:380px;margin:0 auto;padding:16px;color:#111;}
  .center{text-align:center;}
  .bold{font-weight:bold;}
  .divider{border-top:1px dashed #999;margin:8px 0;}
  .row{display:flex;justify-content:space-between;}
  .qr{margin:12px auto;display:block;}
  .badge{background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;}
  .fail-badge{background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;}
  img.logo{max-height:60px;max-width:200px;margin:0 auto 8px;display:block;}
</style>
</head>
<body>
${business?.logoUrl ? `<img src="${business.logoUrl}" class="logo" alt="logo"/>` : ''}
<div class="center bold" style="font-size:16px">${business?.name ?? 'POS Receipt'}</div>
${business?.ntn  ? `<div class="center" style="font-size:11px">NTN: ${business.ntn}</div>`  : ''}
${business?.strn ? `<div class="center" style="font-size:11px">STRN: ${business.strn}</div>` : ''}
${visit.branch?.name ? `<div class="center" style="font-size:11px">${visit.branch.name}${visit.branch.address ? ' — ' + visit.branch.address : ''}</div>` : ''}
<div class="divider"></div>
<div class="row"><span>Invoice #</span><span class="bold">${invoiceNo}</span></div>
<div class="row"><span>Date</span><span>${date}</span></div>
<div class="row"><span>Payment</span><span>${visit.paymentMode ?? 'N/A'}</span></div>
${visit.customer?.fullName ? `<div class="row"><span>Customer</span><span>${visit.customer.fullName}</span></div>` : ''}
<div class="divider"></div>
<div class="row"><span>Subtotal</span><span>${curr} ${subtotal.toFixed(2)}</span></div>
<div class="row"><span>GST (17%)</span><span>${curr} ${gst.toFixed(2)}</span></div>
<div class="divider"></div>
<div class="row bold"><span>TOTAL</span><span>${curr} ${total.toFixed(2)}</span></div>
<div class="divider"></div>
<div class="center" style="font-size:11px;margin:8px 0">
  FBR Status: ${visit.fbrSubmittedAt
    ? `<span class="badge">SUBMITTED</span>`
    : `<span class="fail-badge">PENDING</span>`}
</div>
${qrUrl ? `<div class="center"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrUrl)}" class="qr" width="120" height="120" alt="FBR QR"/><div style="font-size:10px;margin-top:4px">Scan to verify on FBR</div></div>` : ''}
<div class="divider"></div>
<div class="center" style="font-size:11px">Thank you for your purchase!</div>
<script>window.onload=()=>window.print();</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[pos] receipt error', err);
    res.status(500).json({ error: 'Failed to generate receipt' });
  }
});

// ── GET /api/pos/wallet-lookup?phone= ────────────────────────────
// Returns customer points balance + redemption config for POS wallet payment
posRouter.get('/wallet-lookup', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const rawPhone = String(req.query.phone ?? '').trim();
    if (!rawPhone) { res.status(400).json({ error: 'phone required' }); return; }

    const phone = normalisePhone(rawPhone);

    const [customer, biz] = await Promise.all([
      prisma.customer.findFirst({
        where:  { businessId, whatsappNumber: phone },
        select: { id: true, fullName: true, currentPointsBalance: true, currentWalletBalance: true, isSuppressed: true },
      }),
      prisma.business.findUnique({
        where:  { id: businessId },
        select: { redeemRate: true, minRedeemPoints: true, currency: true } as any,
      }),
    ]);

    const redeemRate      = (biz as any)?.redeemRate      ?? 100; // pts per 1 currency unit
    const minRedeemPoints = (biz as any)?.minRedeemPoints ?? 100;
    const currency        = (biz as any)?.currency        ?? 'GBP';

    if (!customer) {
      res.json({ found: false, phone, redeemRate, minRedeemPoints, currency });
      return;
    }

    const balance = customer.currentPointsBalance ?? 0;
    const maxDiscount = balance >= minRedeemPoints
      ? parseFloat((balance / redeemRate).toFixed(2))
      : 0;

    res.json({
      found:            true,
      customerId:       customer.id,
      fullName:         customer.fullName,
      phone,
      pointsBalance:    balance,
      walletBalance:    Number(customer.currentWalletBalance ?? 0), // gift / shop credit (money)
      redeemRate,
      minRedeemPoints,
      maxDiscount,
      currency,
    });
  } catch (err) {
    console.error('[pos] wallet-lookup error', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── POST /api/pos/wallet-redeem ───────────────────────────────────
// Debit points from customer wallet during POS checkout
posRouter.post('/wallet-redeem', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const { customerId, pointsToRedeem, amountDeducted } = req.body as {
      customerId:     string;
      pointsToRedeem: number;
      amountDeducted: number;
    };

    if (!customerId || !pointsToRedeem || pointsToRedeem <= 0) {
      res.status(400).json({ error: 'customerId and pointsToRedeem required' });
      return;
    }

    const customer = await prisma.customer.findFirst({
      where:  { id: customerId, businessId },
      select: { currentPointsBalance: true, isSuppressed: true },
    });
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

    const balance = customer.currentPointsBalance ?? 0;
    if (balance < pointsToRedeem) {
      res.status(400).json({ error: 'Insufficient points', balance });
      return;
    }

    const newBalance = balance - pointsToRedeem;

    await prisma.$transaction([
      prisma.rewardPointsLedger.create({
        data: {
          customerId,
          businessId,
          type:         'DEBIT',
          points:       pointsToRedeem,
          balanceAfter: newBalance,
          reason:       'MANUAL_ADJUSTMENT',
          referenceType:'WALLET_REDEMPTION',
          notes:        `POS wallet payment — ${pointsToRedeem} pts = ${amountDeducted} currency units`,
        } as any,
      }),
      prisma.customer.update({
        where: { id: customerId },
        data:  { currentPointsBalance: newBalance },
        select: { id: true },
      }),
    ]);

    res.json({ ok: true, pointsDebited: pointsToRedeem, newBalance, amountDeducted });
  } catch (err) {
    console.error('[pos] wallet-redeem error', err);
    res.status(500).json({ error: 'Redemption failed' });
  }
});

// ── POST /api/pos/giftcredit-redeem ───────────────────────────────
// Spend a customer's gift / shop-credit (money wallet) at checkout.
posRouter.post('/giftcredit-redeem', async (req: Request, res: Response) => {
  try {
    const businessId = getBizId(req);
    const { customerId, amount } = req.body as { customerId: string; amount: number };
    const spend = Number(amount);
    if (!customerId || !(spend > 0)) { res.status(400).json({ error: 'customerId and positive amount required' }); return; }

    const customer = await prisma.customer.findFirst({
      where:  { id: customerId, businessId },
      select: { currentWalletBalance: true },
    });
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

    const balance = Number(customer.currentWalletBalance ?? 0);
    if (balance < spend) { res.status(400).json({ error: 'Insufficient gift balance', balance }); return; }

    const newBalance = Math.round((balance - spend) * 100) / 100;
    await prisma.$transaction([
      prisma.walletLedger.create({
        data: {
          businessId, customerId,
          type: 'DEBIT', amount: spend, balanceAfter: newBalance,
          reason: 'PURCHASE_DEDUCTION', referenceType: 'POS_GIFT_CREDIT',
        },
      }),
      prisma.customer.update({ where: { id: customerId }, data: { currentWalletBalance: newBalance }, select: { id: true } }),
    ]);

    res.json({ ok: true, amountDeducted: spend, newBalance });
  } catch (err) {
    console.error('[pos] giftcredit-redeem error', err);
    res.status(500).json({ error: 'Redemption failed' });
  }
});
