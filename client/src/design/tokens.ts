// ================================================================
//  Global design tokens — the single source of truth for The Loyaly
//  brand across EVERY surface (marketing site, CRM, customer portal,
//  admin). Papaya-orange, cream light mode, espresso dark mode, glass.
//  Both the marketing site and the CRM derive their palettes from here
//  so the whole product looks like one continuous experience.
// ================================================================

export const BRAND = {
  papaya:   '#F97316',
  light:    '#FF8A3D',
  deep:     '#EA6A0E',
  burnt:    '#C2410C',
  coral:    '#FFB085',
  cream:    '#FFF7ED',
  creamSoft:'#FFFBF5',
  warm:     '#F8F4EF',
  espresso: '#0E0704',
  panel:    '#1A0F0A',
  char:     '#231813',
  text:     '#1C1917',
  muted:    '#78716C',
  border:   '#E7DCD3',
  success:  '#16A34A',
  warning:  '#F59E0B',
  danger:   '#DC2626',
} as const;

// Papaya signature gradient used on CTAs/headers everywhere.
export const GRAD = 'linear-gradient(135deg,#FF8A3D,#F97316)';
export const EASE = 'cubic-bezier(.16,1,.3,1)';

export type ThemeTokens = {
  bg: string; bg2: string; card: string; bdr: string;
  tx: string; tx2: string; tx3: string;
  inp: string; inpBd: string; shadow: string;
};

// Resolve a full token set for a given mode. `dark` = espresso, light = cream.
// Mirrors the CRM's pdTokens() so the two never diverge.
export const tokens = (dark: boolean): ThemeTokens => ({
  bg:     dark ? '#0E0704' : '#FFF7ED',
  bg2:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)',
  card:   dark ? 'rgba(42,25,16,0.55)' : 'rgba(255,255,255,0.82)',
  bdr:    dark ? 'rgba(255,255,255,0.10)' : 'rgba(231,220,211,0.95)',
  tx:     dark ? '#FFF7ED' : '#1C1917',
  tx2:    dark ? 'rgba(255,247,237,0.62)' : '#57534E',
  tx3:    dark ? 'rgba(255,247,237,0.40)' : '#9A8478',
  inp:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.92)',
  inpBd:  dark ? 'rgba(255,255,255,0.14)' : 'rgba(249,115,22,0.25)',
  shadow: dark ? '0 24px 70px rgba(0,0,0,0.38)' : '0 18px 50px rgba(249,115,22,0.10)',
});
