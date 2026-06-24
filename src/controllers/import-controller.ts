// ================================================================
//  import.controller.ts
//  Zero-code CSV/Excel customer import with visual column mapping.
//
//  Flow:
//   1. Business owner drags CSV/XLSX onto the frontend upload zone
//   2. Frontend parses the header row client-side, shows column names
//   3. Owner drags their "Mobile" column onto the "whatsappNumber" field
//   4. Frontend POSTs: the file + a mapping manifest JSON
//   5. This controller:
//      a. Parses the file with csv-parser (streaming — handles large files)
//      b. Applies the mapping manifest to rename columns
//      c. Normalises phone → E.164, email → lowercase
//      d. Upserts customers in batches of 100 inside $transaction
//      e. Returns a detailed import summary
//
//  Column mapping manifest example:
//    { "Mobile": "whatsappNumber", "Full Name": "fullName", "DOB": "birthday" }
//
//  Target system fields:
//    fullName, whatsappNumber, email, birthday, gender, address
//
//  A customer row must have at least one of: whatsappNumber, email
// ================================================================

import { Request, Response, Router }  from 'express';
import multer                          from 'multer';
import csvParser                       from 'csv-parser';
import { Readable }                    from 'stream';
import { z, ZodError }                 from 'zod';
import { Prisma }        from '@prisma/client';
import { prisma } from '../config/prisma';
import { Role }                        from '@prisma/client';
import { tenantScope, requireRoles }   from '../middleware/tenant-scope-middleware';


// ================================================================
// CONSTANTS
// ================================================================

const MAX_FILE_SIZE_MB  = 10;
const BATCH_SIZE        = 100;    // Customers upserted per $transaction
const MAX_ROWS          = 50_000; // Safety cap per import

const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** All supported target field names (system canonical names) */
const TARGET_FIELDS = new Set([
  'fullName',
  'whatsappNumber',
  'email',
  'birthday',
  'gender',
  'address',
]);

// ================================================================
// MULTER CONFIG (memory storage — stream parsing)
// ================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept by MIME type or extension
    const ext = file.originalname.toLowerCase();
    const isAllowedMime = ALLOWED_MIME_TYPES.has(file.mimetype);
    const isAllowedExt  = ext.endsWith('.csv') || ext.endsWith('.xlsx') || ext.endsWith('.xls');

    if (isAllowedMime || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are accepted.'));
    }
  },
});

// ================================================================
// TYPES
// ================================================================

/** Column mapping: { "CSV Header": "systemField" } */
type MappingManifest = Record<string, string>;

interface NormalisedRow {
  fullName?:       string;
  whatsappNumber?: string;
  email?:          string;
  birthday?:       Date;
  gender?:         string;
  address?:        string;
}

interface ImportSummary {
  total:     number;
  created:   number;
  updated:   number;
  skipped:   number;   // No identifiable contact info
  failed:    number;
  errors:    Array<{ row: number; reason: string }>;
  duration:  number;   // ms
}

// ================================================================
// VALIDATION
// ================================================================

const MappingSchema = z.record(z.string(), z.string()).refine(
  manifest => {
    const values = Object.values(manifest);
    return values.some(v => TARGET_FIELDS.has(v));
  },
  { message: 'Mapping must include at least one valid target field.' }
);

// ================================================================
// CORE: CSV ROW PARSER
// ================================================================

/**
 * Parse the uploaded file buffer into an array of raw row objects.
 * Handles: UTF-8 BOM, Windows line endings, quoted fields.
 */
const parseCSVBuffer = (buffer: Buffer): Promise<Record<string, string>[]> =>
  new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];

    // Strip UTF-8 BOM if present
    const cleaned = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF
      ? buffer.slice(3)
      : buffer;

    const readable = Readable.from(cleaned);

    readable
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => header.trim(), // Trim whitespace from headers
          strict:     false,
        })
      )
      .on('data', (row: Record<string, string>) => {
        if (rows.length < MAX_ROWS) rows.push(row);
      })
      .on('end',  () => resolve(rows))
      .on('error', reject);
  });

// ================================================================
// CORE: COLUMN MAPPING APPLIER
// ================================================================

/**
 * Apply the mapping manifest to rename CSV columns into system field names.
 * Unmapped columns are silently dropped.
 * Whitespace is trimmed from all values.
 */
const applyMapping = (
  row:      Record<string, string>,
  manifest: MappingManifest
): NormalisedRow => {
  const result: Record<string, string> = {};

  for (const [csvHeader, systemField] of Object.entries(manifest)) {
    if (!TARGET_FIELDS.has(systemField)) continue;

    const value = (row[csvHeader] ?? '').toString().trim();
    if (value) result[systemField] = value;
  }

  return result;
};

// ================================================================
// NORMALISATION FUNCTIONS
// ================================================================

const normalisePhone = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+'))  return digits.length >= 8 ? digits : null;
  if (digits.startsWith('00')) return digits.length >= 10 ? '+' + digits.slice(2) : null;
  if (digits.startsWith('0') && digits.length === 11) return '+44' + digits.slice(1); // UK
  if (digits.startsWith('0') && digits.length === 10) return '+44' + digits.slice(1); // UK short
  if (digits.length === 10) return '+44' + digits; // UK assumed
  if (digits.length > 10)   return '+' + digits;
  return null;
};

const normaliseEmail = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  // Basic format check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

const normaliseBirthday = (raw: string | undefined): Date | null => {
  if (!raw) return null;

  // Try common date formats: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
  const formats = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,   // DD/MM/YYYY
    /^(\d{4})-(\d{2})-(\d{2})$/,     // YYYY-MM-DD
    /^(\d{2})-(\d{2})-(\d{4})$/,     // DD-MM-YYYY
    /^(\d{2})\.(\d{2})\.(\d{4})$/,   // DD.MM.YYYY
  ];

  for (let i = 0; i < formats.length; i++) {
    const match = raw.match(formats[i]);
    if (match) {
      const [, a, b, c] = match;
      let year: number, month: number, day: number;

      // formats[1] is the ISO YYYY-MM-DD pattern → first group is the year
      if (i === 1) {
        year = parseInt(a); month = parseInt(b) - 1; day = parseInt(c);
      } else {
        day = parseInt(a); month = parseInt(b) - 1; year = parseInt(c);
      }

      const date = new Date(year, month, day);
      const thisYear = new Date().getFullYear();
      if (!isNaN(date.getTime()) && year > 1900 && year <= thisYear) return date;
    }
  }

  // Fallback: let Date constructor try
  const d = new Date(raw);
  return !isNaN(d.getTime()) ? d : null;
};

const normaliseGender = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (['m', 'male', 'man', 'boy'].includes(lower))         return 'MALE';
  if (['f', 'female', 'woman', 'girl'].includes(lower))    return 'FEMALE';
  if (['nb', 'non-binary', 'nonbinary'].includes(lower))   return 'NON_BINARY';
  if (['prefer not', 'unspecified', 'other'].some(s => lower.includes(s))) return 'PREFER_NOT_TO_SAY';
  return null;
};

// ================================================================
// BATCH UPSERT ENGINE
// ================================================================

/**
 * Upsert a batch of normalised rows into the Customer table.
 * Keyed on (whatsappNumber, businessId) or (email, businessId).
 * Runs inside a single $transaction — all-or-nothing per batch.
 */
const upsertCustomerBatch = async (
  businessId: string,
  rows:       NormalisedRow[]
): Promise<{ created: number; updated: number; failed: number; errors: Array<{ reason: string }> }> => {
  let created = 0;
  let updated = 0;
  let failed  = 0;
  const errors: Array<{ reason: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      try {
        const phone = normalisePhone(row.whatsappNumber);
        const email = normaliseEmail(row.email);

        if (!phone && !email) {
          failed++;
          errors.push({ reason: 'No valid phone or email' });
          continue;
        }

        const existing = await tx.customer.findFirst({
          where: {
            businessId,
            OR: [
              ...(phone ? [{ whatsappNumber: phone }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
          select: { id: true },
        });

        const data: Prisma.CustomerUpdateInput = {
          ...(row.fullName  && { fullName:  row.fullName }),
          ...(phone         && { whatsappNumber: phone }),
          ...(email         && { email }),
          ...(row.birthday  && { birthday:  normaliseBirthday(row.birthday as any as string) }),
          ...(row.gender    && { gender:    normaliseGender(row.gender) }),
          ...(row.address   && { address:   row.address }),
          updatedAt: new Date(),
        };

        if (existing) {
          await tx.customer.update({ where: { id: existing.id }, data, select: { id: true } });
          updated++;
        } else {
          await tx.customer.create({
            data: {
              businessId,
              fullName:  row.fullName ?? extractNameFromEmail(email) ?? 'Imported Customer',
              whatsappNumber: phone,
              email,
              birthday:  row.birthday ? normaliseBirthday(row.birthday as any as string) : null,
              gender:    row.gender   ? normaliseGender(row.gender) : null,
              address:   row.address,
              segment:   'NEW',
              visitCount: 0,
              totalSpend: 0,
              marketingConsentWhatsapp: false, // Requires explicit consent
              marketingConsentEmail:    false,
            },
          });
          created++;
        }
      } catch (err) {
        failed++;
        errors.push({ reason: err instanceof Error ? err.message.substring(0, 100) : 'Unknown' });
      }
    }
  });

  return { created, updated, failed, errors };
};

// ================================================================
// HEADER PREVIEW HANDLER
// ================================================================

/**
 * POST /api/import/preview-headers
 * Accepts file upload, returns the CSV headers without processing data.
 * Used by the frontend to populate the column mapping UI.
 */
const previewHeadersHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: 'No file uploaded.' }); return; }

    const rows = await parseCSVBuffer(file.buffer);

    if (rows.length === 0) {
      res.status(422).json({ error: 'File is empty or could not be parsed.' });
      return;
    }

    const headers    = Object.keys(rows[0]);
    const sampleRows = rows.slice(0, 3); // First 3 rows for preview

    res.status(200).json({
      headers,
      sampleRows,
      rowCount:     rows.length,
      targetFields: Array.from(TARGET_FIELDS),
      hint: 'Map your CSV headers to the target system fields using the drag-and-drop interface.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PARSE_ERROR';
    res.status(422).json({ error: msg });
  }
};

// ================================================================
// MAIN IMPORT HANDLER
// ================================================================

/**
 * POST /api/import/customers
 * Multipart form data:
 *   file:    CSV or Excel file
 *   mapping: JSON string { "CSV Header": "systemField" }
 */
const importCustomersHandler = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: 'No file uploaded.' }); return; }

    // Parse and validate mapping manifest
    let manifest: MappingManifest;
    try {
      const raw = typeof req.body.mapping === 'string'
        ? JSON.parse(req.body.mapping)
        : req.body.mapping;
      manifest = MappingSchema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'INVALID_MAPPING', details: err.errors });
      } else {
        res.status(400).json({ error: 'INVALID_MAPPING_JSON' });
      }
      return;
    }

    const { businessId, userId } = req.tenantContext;

    // Parse the file
    const rows = await parseCSVBuffer(file.buffer);

    if (rows.length === 0) {
      res.status(422).json({ error: 'FILE_EMPTY', message: 'No data rows found in file.' });
      return;
    }

    const summary: ImportSummary = {
      total: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], duration: 0,
    };

    // Apply mapping + normalise rows
    const normalisedRows: NormalisedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const mapped = applyMapping(rows[i], manifest);
      const phone  = normalisePhone(mapped.whatsappNumber);
      const email  = normaliseEmail(mapped.email);

      if (!phone && !email) {
        summary.skipped++;
        if (summary.errors.length < 20) {
          summary.errors.push({ row: i + 2, reason: 'No valid phone or email in this row.' });
        }
        continue;
      }

      normalisedRows.push({
        ...mapped,
        whatsappNumber: phone ?? undefined,
        email:          email ?? undefined,
      });
    }

    // Batch upsert in chunks of BATCH_SIZE
    for (let i = 0; i < normalisedRows.length; i += BATCH_SIZE) {
      const batch  = normalisedRows.slice(i, i + BATCH_SIZE);
      const result = await upsertCustomerBatch(businessId, batch);

      summary.created += result.created;
      summary.updated += result.updated;
      summary.failed  += result.failed;

      result.errors.forEach((e, j) => {
        if (summary.errors.length < 50) {
          summary.errors.push({ row: i + j + 2, reason: e.reason });
        }
      });
    }

    summary.duration = Date.now() - startTime;

    // Audit log
    await prisma.auditLog.create({
      data: {
        businessId,
        userId,
        action:     'CSV_IMPORT',
        metaJson: {
          fileName:  file.originalname,
          totalRows: rows.length,
          created:   summary.created,
          updated:   summary.updated,
          skipped:   summary.skipped,
          failed:    summary.failed,
          duration:  summary.duration,
        },
      },
    }).catch(console.error);

    res.status(200).json({
      summary,
      message: `Import complete: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed.`,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'IMPORT_FAILED';
    console.error('[import.controller]', err);
    res.status(500).json({ error: msg });
  }
};

// ================================================================
// ROUTER
// ================================================================

export const importRouter = Router();
importRouter.use(tenantScope as any);

// Preview headers (Owner + Marketing Staff)
importRouter.post(
  '/preview-headers',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  upload.single('file'),
  previewHeadersHandler
);

// Full import (Owner only — bulk data modification is sensitive)
importRouter.post(
  '/customers',
  requireRoles(Role.TENANT_OWNER) as any,
  upload.single('file'),
  importCustomersHandler
);

// ================================================================
// UTILITIES
// ================================================================

const extractNameFromEmail = (email: string | null): string | null => {
  if (!email) return null;
  const local = email.split('@')[0].replace(/[._\-+]/g, ' ').trim();
  return local
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || null;
};

// ================================================================
// MOUNT IN app.ts:
//   import { importRouter } from './controllers/import.controller';
//   app.use('/api/import',  importRouter);
// ================================================================
