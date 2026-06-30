// Site theme = the global design tokens + a persisted dark/light hook.
// Uses the SAME `site_dark` key the in-CRM LandingPage uses, so toggling on
// the marketing site and stepping into auth stays perfectly in sync.
import { useState, useEffect, useCallback } from 'react';
import { tokens, type ThemeTokens } from '../design/tokens';
export { BRAND, GRAD, EASE, tokens } from '../design/tokens';
export type { ThemeTokens };

export const useTheme = () => {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('site_dark');
    return saved === null ? true : saved === 'true'; // default dark (espresso)
  });
  useEffect(() => {
    localStorage.setItem('site_dark', String(dark));
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const toggle = useCallback(() => setDark(d => !d), []);
  const t: ThemeTokens = tokens(dark);
  return { dark, toggle, t };
};
