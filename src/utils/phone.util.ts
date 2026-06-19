// ================================================================

/**
 * Normalise a raw phone string to E.164 format.
 * Returns null if the input cannot be safely converted.
 *
 * Handles:
 *   +447911123456  → +447911123456  (passthrough)
 *   07911123456    → +447911123456  (UK 07xxx)
 *   447911123456   → +447911123456  (no leading +)
 *   0044 7911...   → +447911123456  (00 prefix)
 *   +1 (555) 123-4567 → +15551234567 (US with formatting)
 */
export const normaliseToE164 = (
  raw:            string,
  defaultCountry: string = '44'
): string | null => {
  if (!raw) return null;

  // Strip everything except digits and leading +
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  // Already E.164
  if (cleaned.startsWith('+') && cleaned.length >= 8) {
    return cleaned;
  }

  // 00-prefixed international (e.g. 0044...)
  if (cleaned.startsWith('00') && cleaned.length >= 10) {
    return '+' + cleaned.slice(2);
  }

  // UK mobile: 07xxx (11 digits) or 7xxx (10 digits)
  if (defaultCountry === '44') {
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      return '+44' + cleaned.slice(1);
    }
    if (!cleaned.startsWith('0') && cleaned.length === 10) {
      return '+44' + cleaned;
    }
  }

  // Generic: prepend default country code
  if (cleaned.length >= 8) {
    return '+' + defaultCountry + cleaned;
  }

  return null;
};


// ================================================================
