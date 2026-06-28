// ================================================================
//  whatsapp-provider.ts
//  Single source of truth for which WhatsApp provider the platform uses.
//
//  Resolution order:
//    1. WHATSAPP_PROVIDER=baileys            → in-process Baileys
//    2. WHATSAPP_PROVIDER=waha | meta        → external WAHA / Meta Cloud
//    3. unset → default to Baileys UNLESS an external WAHA base URL is
//       configured (WAHA_BASE_URL). This means a single-container deploy
//       (e.g. Railway) connects WhatsApp out of the box with no extra
//       service to stand up, while existing WAHA setups keep working.
//
//  The decision is based purely on env vars, so it is stable for the life
//  of the process and safe to evaluate once at module load.
// ================================================================

export function useBaileys(): boolean {
  const provider = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
  if (provider === 'baileys') return true;
  if (provider === 'waha' || provider === 'meta') return false;
  // Unset: prefer in-process Baileys unless a real WAHA endpoint is set.
  const wahaUrl = process.env.WAHA_BASE_URL?.trim();
  return !wahaUrl;
}

/** True when the platform should talk to an external WAHA / Meta gateway. */
export const useWaha = (): boolean => !useBaileys();
