import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Menu, X, Sun, Moon } from 'lucide-react';
import { m } from '../design/motion';
import { Button } from '../design/ui';
import { BRAND, type ThemeTokens } from '../design/tokens';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/product', label: 'Product' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
];

export const MarketingNav = ({ t, dark, toggle }: { t: ThemeTokens; dark: boolean; toggle: () => void }) => {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const glass: React.CSSProperties = {
    background: dark ? 'rgba(26,15,10,0.62)' : 'rgba(255,255,255,0.66)',
    border: `1px solid ${t.bdr}`,
    backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
  };
  return (
    <div className="sticky top-0 z-50 px-3 pt-3 md:px-6 md:pt-5">
      <m.nav initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}
        className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-3 py-2.5 md:px-4" style={glass}>
        <button onClick={() => nav('/')} className="flex items-center gap-2 shrink-0" aria-label="The Loyaly home">
          <img src={dark ? '/white.png' : '/black.png'} alt="The Loyaly" className="h-7 w-auto object-contain" loading="eager" decoding="async" />
        </button>

        <div className="hidden md:flex items-center gap-1">
          {LINKS.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={({ isActive }) => ({ color: isActive ? BRAND.papaya : t.tx2, background: isActive ? `${BRAND.papaya}14` : 'transparent' })}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={toggle} aria-label="Toggle theme" className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors" style={{ color: t.tx2, border: `1px solid ${t.bdr}` }}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="hidden sm:block"><Button variant="ghost" t={t} onClick={() => nav('/login')}>Sign in</Button></div>
          <div className="hidden sm:block"><Button variant="primary" onClick={() => nav('/signup')}>Start free</Button></div>
          <button onClick={() => setOpen(o => !o)} aria-label="Menu" className="md:hidden flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: t.tx, border: `1px solid ${t.bdr}` }}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </m.nav>

      {/* Mobile drawer */}
      {open && (
        <m.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="md:hidden mx-auto mt-2 max-w-6xl rounded-2xl p-3" style={glass}>
          {LINKS.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end} onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium" style={({ isActive }) => ({ color: isActive ? BRAND.papaya : t.tx })}>
              {l.label}
            </NavLink>
          ))}
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" t={t} className="flex-1" onClick={() => { setOpen(false); nav('/login'); }}>Sign in</Button>
            <Button variant="primary" className="flex-1" onClick={() => { setOpen(false); nav('/signup'); }}>Start free</Button>
          </div>
        </m.div>
      )}
    </div>
  );
};
