// ================================================================
//  upload-controller.ts
//  Handles file uploads (menu images / PDFs) for portal settings.
//  Files are stored in /uploads and served at /uploads/<filename>.
//  Max size: 10 MB. Allowed: jpg, jpeg, png, webp, pdf.
// ================================================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { tenantScope } from '../middleware/tenant-scope-middleware';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed'));
  },
});

export const uploadRouter = Router();

/** POST /api/upload/menu — upload a menu file; returns { url } */
uploadRouter.post('/menu', tenantScope, upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});
