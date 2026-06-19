// ================================================================
//  FBR (Federal Board of Revenue) PRAL API Integration
//  Pakistan GST / Sales Tax e-invoicing
// ================================================================

const FBR_SANDBOX_URL = 'https://esp.fbr.gov.pk:8244/api/invoice';
const FBR_PROD_URL    = 'https://esp.fbr.gov.pk/api/invoice';

export interface FBRItem {
  ItemCode:    string;
  ItemName:    string;
  Quantity:    number;
  PCTCode:     string;   // Pakistan Customs Tariff code
  TaxRate:     number;   // 17 for standard GST
  SaleValue:   number;
  TotalAmount: number;
  TaxCharged:  number;
  Discount:    number;
  FurtherTax:  number;
  InvoiceType: number;
}

export interface FBRInvoice {
  POSID:             number;
  USIN:              string;   // Unique Sales Invoice Number
  DateTime:          string;   // "DD/MM/YYYY HH:MM:SS"
  BuyerNTN?:         string;
  BuyerCNIC?:        string;
  BuyerName?:        string;
  BuyerPhoneNumber?: string;
  TotalBillAmount:   number;
  TotalQuantity:     number;
  TotalSaleValue:    number;
  TotalTaxCharged:   number;
  Discount:          number;
  FurtherTax:        number;
  PaymentMode:       number;   // 1=cash, 2=card, 3=mobile wallet
  RefUSIN?:          string;
  InvoiceType:       number;   // 1=normal, 3=credit note
  Items:             FBRItem[];
}

export interface FBRSubmitResult {
  invoiceNumber: string;
  qrCode:        string;
}

// ── GST Calculator ────────────────────────────────────────────────
export function calculateGST(
  amount: number,
  rate: number = 17,
): { taxable: number; tax: number; total: number } {
  const taxable = parseFloat((amount / (1 + rate / 100)).toFixed(2));
  const tax     = parseFloat((amount - taxable).toFixed(2));
  const total   = parseFloat(amount.toFixed(2));
  return { taxable, tax, total };
}

// ── USIN Generator ────────────────────────────────────────────────
export function generateInvoiceNumber(
  businessId: string,
  transactionId: string,
): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const biz  = businessId.slice(-4).toUpperCase();
  const tid  = transactionId.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, '0');
  return `${biz}-${tid}-${ts}`;
}

// ── Format date for FBR ───────────────────────────────────────────
export function fbrDateTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

// ── Submit Invoice ────────────────────────────────────────────────
export async function submitInvoice(
  invoice: FBRInvoice,
  posId: number,
  token: string,
): Promise<FBRSubmitResult> {
  const isSandbox = process.env.NODE_ENV !== 'production';

  // Sandbox mode: return mock data without hitting FBR
  if (isSandbox) {
    const mockInvoiceNumber = `SANDBOX-${invoice.USIN}-${Date.now()}`;
    console.log(`[fbr-service] SANDBOX mode — mock invoice: ${mockInvoiceNumber}`);
    return {
      invoiceNumber: mockInvoiceNumber,
      qrCode:        `https://esp.fbr.gov.pk/verify?invoice=${encodeURIComponent(mockInvoiceNumber)}`,
    };
  }

  const url = FBR_PROD_URL;

  const payload = {
    ...invoice,
    POSID: posId,
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`FBR API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // FBR PRAL response shape: { InvoiceNumber: string, QRCode: string, ... }
  return {
    invoiceNumber: data.InvoiceNumber ?? data.invoiceNumber ?? invoice.USIN,
    qrCode:        data.QRCode        ?? data.qrCode        ?? '',
  };
}

// ── Build FBRInvoice from sale data ──────────────────────────────
export interface SaleItem {
  name:       string;
  qty:        number;
  unitPrice:  number;
  pctCode?:   string;
}

export function buildFBRInvoice(opts: {
  usin:        string;
  posId:       number;
  items:       SaleItem[];
  paymentMode: 'CASH' | 'CARD' | 'WALLET';
  discount?:   number;
  gstRate?:    number;
  buyerName?:  string;
  buyerPhone?: string;
  buyerCnic?:  string;
  date?:       Date;
}): FBRInvoice {
  const gstRate  = opts.gstRate ?? 17;
  const discount = opts.discount ?? 0;
  const date     = opts.date ?? new Date();

  const paymentModeMap: Record<string, number> = {
    CASH:   1,
    CARD:   2,
    WALLET: 3,
  };

  let totalSaleValue   = 0;
  let totalTaxCharged  = 0;
  let totalQuantity    = 0;

  const fbrItems: FBRItem[] = opts.items.map((item) => {
    const lineTotal  = item.qty * item.unitPrice;
    const { taxable, tax } = calculateGST(lineTotal, gstRate);

    totalSaleValue  += taxable;
    totalTaxCharged += tax;
    totalQuantity   += item.qty;

    return {
      ItemCode:    item.name.slice(0, 8).toUpperCase().replace(/\s/g, '_'),
      ItemName:    item.name,
      Quantity:    item.qty,
      PCTCode:     item.pctCode ?? '9999.0000',
      TaxRate:     gstRate,
      SaleValue:   parseFloat(taxable.toFixed(2)),
      TotalAmount: parseFloat(lineTotal.toFixed(2)),
      TaxCharged:  parseFloat(tax.toFixed(2)),
      Discount:    0,
      FurtherTax:  0,
      InvoiceType: 1,
    };
  });

  const totalBillAmount = parseFloat((totalSaleValue + totalTaxCharged - discount).toFixed(2));

  return {
    POSID:             opts.posId,
    USIN:              opts.usin,
    DateTime:          fbrDateTime(date),
    BuyerName:         opts.buyerName,
    BuyerPhoneNumber:  opts.buyerPhone,
    BuyerCNIC:         opts.buyerCnic,
    TotalBillAmount:   totalBillAmount,
    TotalQuantity:     totalQuantity,
    TotalSaleValue:    parseFloat(totalSaleValue.toFixed(2)),
    TotalTaxCharged:   parseFloat(totalTaxCharged.toFixed(2)),
    Discount:          discount,
    FurtherTax:        0,
    PaymentMode:       paymentModeMap[opts.paymentMode] ?? 1,
    InvoiceType:       1,
    Items:             fbrItems,
  };
}
