// ================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate a URL-safe, unique slug from a business name.
 *
 * "The Coffee House"  → "the-coffee-house"
 * "The Coffee House"  → "the-coffee-house-1" (if taken)
 * "The Coffee House"  → "the-coffee-house-2" (if that's taken)
 *
 * Max length: 50 characters (truncated before suffix appended).
 */
export const generateBusinessSlug = async (name: string): Promise<string> => {
  const base = name
    .toLowerCase()
    .normalize('NFD')                         // Decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')          // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, '')            // Remove non-alphanumeric
    .trim()
    .replace(/[\s_-]+/g, '-')                 // Spaces/underscores → hyphens
    .replace(/^-+|-+$/g, '')                  // Trim leading/trailing hyphens
    .slice(0, 50);

  if (!base) return `business-${Date.now()}`;

  let slug    = base;
  let attempt = 0;

  while (true) {
    const existing = await prisma.business.findUnique({
      where:  { slug },
      select: { id: true },
    });

    if (!existing) return slug;

    attempt++;
    slug = `${base}-${attempt}`;
  }
};


// ================================================================
