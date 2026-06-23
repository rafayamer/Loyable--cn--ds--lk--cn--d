// ================================================================
//  fbr-service.ts  — Pakistan FBR POS Integration
//
//  FBR requires all POS systems in Pakistan to submit every sale
//  and print the FBR invoice number on receipts.
//
//  Setup steps:
//    1. Register at https://iris.fbr.gov.pk (NTN/CNIC login)
//    2. Declarations → POS Parameter Registration
//    3. Get POSID, UserID, set password
//    4. Enter credentials in Settings → FBR / Tax
//    5. Keep sandbox=true until you go live
//
//  Sandbox:    https://gw-sandbox.fbr.gov.pk/imsp/v1/api/SaleInvoice
//  Production: https://gw.fbr.gov.pk/imsp/v1/api/SaleInvoice
// ================================================================

import { prisma } from '../config/prisma';

export interface FBRConfig {
  posId:      string;
  userId:     string;
  password:   string;
  ntn:        string;
  taxNumber?: string;
  sandbox:    boolean;
}

export interface FBRSaleItem {
  itemCode:   string;
  itemName:   string;
  quantity:   number;
  saleValue:  number;
  taxRate:    number;
  taxCharged: number;
  totalSale:  number;
}

export interface FBRInvoiceRequest {
  invoiceNumber:   string;
  invoiceDateTime: string;
  totalSaleValue:  number;
  totalTaxCharged: number;
  totalBillAmount: number;
  paymentMode:     'CASH' | 'CARD' | 'ONLINE';
  buyerNTN?:       string;
  buyerName?:      string;
  items:           FBRSaleItem[];
}

export interface FBRInvoiceResponse {
  success:          boolean;
  fbrInvoiceNumber: string;
  qrCode?:          string;
  errorCode?:       string;
  errorMessage?:    string;
}

const SANDBOX_URL    = 'https://gw-sandbox.fbr.gov.pk/imsp/v1/api/SaleInvoice';
const PRODUCTION_URL = 'https://gw.fbr.gov.pk/imsp/v1/api/SaleInvoice';

export const submitFBRInvoice = async (
  config: FBRConfig,
  invoice: FBRInvoiceRequest
): Promise<FBRInvoiceResponse> => {
  const url = config.sandbox ? SANDBOX_URL : PRODUCTION_URL;

  const payload = {
    InvoiceNumber:    invoice.invoiceNumber,
    POSID:            config.posId,
    USIN:             `${config.posId}-${invoice.invoiceNumber}`,
    DateTime:         invoice.invoiceDateTime,
    BuyerNTN:         invoice.buyerNTN || '',
    BuyerName:        invoice.buyerName || '',
    BuyerPhoneNumber: '',
    TotalBillAmount:  invoice.totalBillAmount,
    TotalQuantity:    invoice.items.reduce((s, i) => s + i.quantity, 0),
    TotalSaleValue:   invoice.totalSaleValue,
    TotalTaxCharged:  invoice.totalTaxCharged,
    Discount:         0,
    FurtherTax:       0,
    PaymentMode:      invoice.paymentMode === 'CARD' ? 2 : invoice.paymentMode === 'ONLINE' ? 3 : 1,
    RefUSIN:          '',
    InvoiceType:      1,
    Items: invoice.items.map((item, idx) => ({
      ItemCode:    item.itemCode || String(idx + 1),
      ItemName:    item.itemName,
      Quantity:    item.quantity,
      PCTCode:     '',
      TaxRate:     item.taxRate,
      SaleValue:   item.saleValue,
      Discount:    0,
      FurtherTax:  0,
      TaxCharged:  item.taxCharged,
      TotalAmount: item.totalSale,
    })),
  };

  const authHeader = Buffer.from(`${config.userId}:${config.password}`).toString('base64');

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${authHeader}` },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error('[fbr] HTTP error:', res.status, errText);
      // For sandbox: still return a sandbox number so receipt can print
      if (config.sandbox) {
        return { success: true, fbrInvoiceNumber: `SB-${config.posId}-${invoice.invoiceNumber}`, errorMessage: `Sandbox note: ${errText}` };
      }
      return { success: false, fbrInvoiceNumber: '', errorCode: String(res.status), errorMessage: errText };
    }

    const data = await res.json();
    if (data.Code === 100) {
      const fbrNum = data.InvoiceNumber || `${config.posId}-${invoice.invoiceNumber}`;
      return {
        success:          true,
        fbrInvoiceNumber: fbrNum,
        qrCode:           `https://www.fbr.gov.pk/Verification?q=${encodeURIComponent(fbrNum)}`,
      };
    }

    // Sandbox: always return a number even on error
    if (config.sandbox) {
      return { success: true, fbrInvoiceNumber: `SB-${config.posId}-${invoice.invoiceNumber}`, errorMessage: data.Response };
    }
    return { success: false, fbrInvoiceNumber: '', errorCode: String(data.Code), errorMessage: data.Response };
  } catch (err: any) {
    console.error('[fbr] Network error:', err.message);
    // Sandbox fallback — never block a sale
    if (config.sandbox) {
      return { success: true, fbrInvoiceNumber: `SB-${config.posId}-${invoice.invoiceNumber}`, errorMessage: err.message };
    }
    return { success: false, fbrInvoiceNumber: '', errorMessage: err.message };
  }
};

export const getFBRConfig = async (businessId: string): Promise<FBRConfig | null> => {
  const biz = await (prisma.business as any).findUnique({
    where:  { id: businessId },
    select: { country: true, fbrPosId: true, fbrUserId: true, fbrPassword: true, ntn: true, taxNumber: true, fbrSandbox: true },
  });
  if (!biz || biz.country !== 'PK') return null;
  if (!biz.fbrPosId || !biz.fbrUserId || !biz.fbrPassword || !biz.ntn) return null;
  return {
    posId:     biz.fbrPosId,
    userId:    biz.fbrUserId,
    password:  biz.fbrPassword,
    ntn:       biz.ntn,
    taxNumber: biz.taxNumber ?? undefined,
    sandbox:   biz.fbrSandbox ?? true,
  };
};

// ── Compatibility aliases used by pos-controller ──────────────────

export interface SaleItem {
  name:      string;
  qty:       number;
  unitPrice: number;
}

/** GST calculation used by pos-controller (subtotal already discounted). */
export const calculateGST = (subtotal: number, gstRate: number) => {
  const rate     = gstRate / 100;
  const taxable  = Math.round((subtotal / (1 + rate)) * 100) / 100;
  const tax      = Math.round((subtotal - taxable)    * 100) / 100;
  return { tax, taxable };
};

export const generateInvoiceNumber = (businessId: string, transactionId: string): string =>
  `${businessId.slice(-4).toUpperCase()}-${transactionId.slice(-8).toUpperCase()}`;

export const buildFBRInvoice = (opts: {
  usin:         string;
  posId:        number;
  items:        SaleItem[];
  paymentMode:  string;
  discount?:    number;
  gstRate?:     number;
  buyerName?:   string;
  buyerPhone?:  string;
}): FBRInvoiceRequest => {
  const gstRate   = opts.gstRate ?? 17;
  const discount  = opts.discount ?? 0;
  const subtotal  = opts.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const net       = subtotal - discount;
  const { tax, taxable } = calculateGST(net, gstRate);

  const fbrItems: FBRSaleItem[] = opts.items.map((item, idx) => {
    const totalSale  = item.qty * item.unitPrice;
    const saleValue  = Math.round((totalSale / (1 + gstRate / 100)) * 100) / 100;
    const taxCharged = Math.round((totalSale - saleValue) * 100) / 100;
    return { itemCode: String(idx + 1), itemName: item.name, quantity: item.qty, saleValue, taxRate: gstRate, taxCharged, totalSale };
  });

  const pmMap: Record<string, 'CASH' | 'CARD' | 'ONLINE'> = { CASH: 'CASH', CARD: 'CARD', WALLET: 'ONLINE' };
  return {
    invoiceNumber:   opts.usin,
    invoiceDateTime: new Date().toISOString(),
    totalSaleValue:  taxable,
    totalTaxCharged: tax,
    totalBillAmount: net,
    paymentMode:     pmMap[opts.paymentMode?.toUpperCase()] ?? 'CASH',
    buyerName:       opts.buyerName,
    items:           fbrItems,
  };
};

/** Old alias — submitFBRInvoice with a token-based config (for pos-controller compat). */
export const submitInvoice = async (
  invoice: FBRInvoiceRequest,
  posId: number,
  token: string,
): Promise<{ invoiceNumber?: string; qrCode?: string }> => {
  // Legacy stub: pos-controller still uses this. The new fbr-service uses Basic Auth.
  // Return a sandbox invoice number without making a real call if no real credentials.
  const fake = `SB-${posId}-${invoice.invoiceNumber}`;
  try {
    const url = 'https://gw-sandbox.fbr.gov.pk/imsp/v1/api/SaleInvoice';
    const payload = {
      InvoiceNumber:   invoice.invoiceNumber,
      POSID:           posId,
      USIN:            `${posId}-${invoice.invoiceNumber}`,
      DateTime:        invoice.invoiceDateTime,
      BuyerName:       invoice.buyerName || '',
      TotalBillAmount: invoice.totalBillAmount,
      TotalSaleValue:  invoice.totalSaleValue,
      TotalTaxCharged: invoice.totalTaxCharged,
      PaymentMode:     invoice.paymentMode === 'CARD' ? 2 : invoice.paymentMode === 'ONLINE' ? 3 : 1,
      InvoiceType:     1,
      Items:           invoice.items.map((i, idx) => ({ ItemCode: String(idx + 1), ItemName: i.itemName, Quantity: i.quantity, TaxRate: i.taxRate, SaleValue: i.saleValue, TaxCharged: i.taxCharged, TotalAmount: i.totalSale })),
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000) });
    const data = await res.json().catch(() => ({}));
    return { invoiceNumber: data.InvoiceNumber || fake, qrCode: undefined };
  } catch {
    return { invoiceNumber: fake };
  }
};

export const computeGST = (
  items: { name: string; qty: number; price: number }[],
  gstRate: number
) => {
  const rate = gstRate / 100;
  const fbrItems: FBRSaleItem[] = items.map((item, i) => {
    const totalSale  = Math.round(item.qty * item.price * 100) / 100;
    const saleValue  = Math.round((totalSale / (1 + rate)) * 100) / 100;
    const taxCharged = Math.round((totalSale - saleValue) * 100) / 100;
    return { itemCode: String(i + 1), itemName: item.name, quantity: item.qty, saleValue, taxRate: gstRate, taxCharged, totalSale };
  });
  return {
    items:    fbrItems,
    subtotal: Math.round(fbrItems.reduce((s, i) => s + i.saleValue,  0) * 100) / 100,
    tax:      Math.round(fbrItems.reduce((s, i) => s + i.taxCharged, 0) * 100) / 100,
    total:    Math.round(fbrItems.reduce((s, i) => s + i.totalSale,  0) * 100) / 100,
  };
};
