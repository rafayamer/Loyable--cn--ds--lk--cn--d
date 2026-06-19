// ================================================================
//  POS Controller — Manual sale entry + FBR e-invoicing
//  REST endpoints for the CRM frontend POS page
// ================================================================

import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  submitInvoice,
  generateInvoiceNumber,
  calculateGST,
  buildFBRInvoice,
  SaleItem,
} from '../services/fbr-service';

const prisma = new PrismaClient();
export const posRouter = Router();

// ── Helper: get authenticated business ID from middleware context ──
function getBizId(req: Request): string {
  return (req as any).businessId as string;
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

    // Fetch business FBR settings
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        fbrEnabled: true,
        fbrPosId:   true,
        fbrToken:   true,
        gstRate:    true,
        ntn:        true,
        strn:       true,
      },
    });

    const gstRate = business?.gstRate ?? 17;

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const { tax: gstAmount, taxable } = calculateGST(subtotal - discount, gstRate);
    const totalAmount = subtotal - discount;

    // Find or create customer
    let customerId: string | null = null;
    if (customerPhone) {
      const normalizedPhone = customerPhone.startsWith('+')
        ? customerPhone
        : `+${customerPhone}`;

      let customer = await prisma.customer.findFirst({
        where: {
          businessId,
          OR: [
            { whatsappNumber: normalizedPhone },
            { whatsappNumber: customerPhone },
          ],
        },
      });

      if (!customer && customerName) {
        customer = await prisma.customer.create({
          data: {
            businessId,
            fullName:       customerName,
            whatsappNumber: normalizedPhone,
            segment:        'NEW',
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
          fullName: anonName,
          segment:  'NEW',
        },
      });
      customerId = anon.id;
    }

    const transactionId = `POS-${businessId.slice(-6)}-${Date.now()}`;
    const usin = generateInvoiceNumber(businessId, transactionId);

    // Submit to FBR if enabled
    let fbrInvoiceNumber: string | undefined;
    let fbrQrCode: string | undefined;
    let fbrSubmittedAt: Date | undefined;

    if (business?.fbrEnabled || process.env.NODE_ENV !== 'production') {
      try {
        const posId = business?.fbrPosId ?? parseInt(process.env.FBR_POS_ID ?? '1', 10);
        const token = business?.fbrToken ?? process.env.FBR_TOKEN ?? 'sandbox-token';

        const fbrInvoice = buildFBRInvoice({
          usin,
          posId,
          items,
          paymentMode,
          discount,
          gstRate,
          buyerName:  customerName,
          buyerPhone: customerPhone,
        });

        const result = await submitInvoice(fbrInvoice, posId, token);
        fbrInvoiceNumber = result.invoiceNumber;
        fbrQrCode        = result.qrCode;
        fbrSubmittedAt   = new Date();
      } catch (fbrErr) {
        console.error('[pos] FBR submission failed:', fbrErr);
        // Don't block the sale — log and continue
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
      where: { id: customerId },
      data:  {
        visitCount:    { increment: 1 },
        totalSpend:    { increment: new Prisma.Decimal(totalAmount.toFixed(2)) },
        lastVisitAt:   new Date(),
        firstVisitAt:  undefined,
      },
    });

    res.status(201).json({
      visit,
      fbrInvoiceNumber,
      fbrQrCode,
      gstAmount,
      totalAmount,
      transactionId,
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
        pctCode:   '9999.0000',
      }],
      paymentMode: (visit.paymentMode as 'CASH' | 'CARD' | 'WALLET') ?? 'CASH',
      gstRate:     business?.gstRate ?? 17,
      buyerName:   visit.customer?.fullName,
      buyerPhone:  visit.customer?.whatsappNumber ?? undefined,
      date:        visit.visitedAt,
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
      select: { name: true, ntn: true, strn: true, currency: true },
    });

    const gst       = Number(visit.gstAmount ?? 0);
    const total     = Number(visit.amountSpent ?? 0);
    const subtotal  = total - gst;
    const date      = new Date(visit.visitedAt).toLocaleString('en-PK');
    const qrUrl     = visit.fbrQrCode ?? '';
    const invoiceNo = visit.fbrInvoiceNumber ?? 'PENDING';

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
</style>
</head>
<body>
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
<div class="row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
<div class="row"><span>GST (17%)</span><span>${gst.toFixed(2)}</span></div>
<div class="divider"></div>
<div class="row bold"><span>TOTAL</span><span>${total.toFixed(2)}</span></div>
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
