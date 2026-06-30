// ================================================================
//  Shared UI primitives — glassmorphic, papaya-branded, theme-aware.
//  Reused by the marketing site (and adoptable by CRM/portal/admin)
//  so every surface shares one component language.
// ================================================================
import React from 'react';
import { m, hoverLift } from './motion';
import { BRAND, GRAD, type ThemeTokens } from './tokens';

// Glass surface card. Pass tokens `t` for theme-aware bg/border/shadow.
export const GlassCard = ({ t, children, className = '', style = {}, hover = false, glow = false, noClip = false, onClick }: {
  t: ThemeTokens; children: React.ReactNode; className?: string; style?: React.CSSProperties;
  hover?: boolean; glow?: boolean; noClip?: boolean; onClick?: () => void;
}) => {
  const base: React.CSSProperties = {
    background: t.card,
    border: `1px solid ${t.bdr}`,
    borderRadius: 20,
    boxShadow: glow ? `0 0 0 1px rgba(249,115,22,0.14), 0 18px 55px rgba(249,115,22,0.22)` : t.shadow,
    backdropFilter: 'blur(18px) saturate(140%)',
    WebkitBackdropFilter: 'blur(18px) saturate(140%)',
    ...style,
  };
  const Comp: any = hover ? m.div : 'div';
  return (
    <Comp className={`relative ${noClip ? '' : 'overflow-hidden'} ${className}`} style={base} onClick={onClick} {...(hover ? hoverLift : {})}>
      {children}
    </Comp>
  );
};

// Primary / secondary / ghost button. Renders <a> when href given.
export const Button = ({ children, variant = 'primary', t, href, onClick, className = '', style = {}, type = 'button' }: {
  children: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; t?: ThemeTokens;
  href?: string; onClick?: () => void; className?: string; style?: React.CSSProperties; type?: 'button' | 'submit';
}) => {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: GRAD, color: '#fff', border: '1px solid transparent' },
    secondary: { background: t?.bg2 ?? 'rgba(255,255,255,0.06)', color: t?.tx ?? '#fff', border: `1px solid ${t?.bdr ?? 'rgba(255,255,255,0.14)'}` },
    ghost: { background: 'transparent', color: t?.tx2 ?? '#fff', border: '1px solid transparent' },
  };
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:brightness-105 active:scale-[0.98] ${className}`;
  const s = { ...styles[variant], ...style };
  if (href) return <a href={href} className={cls} style={s}>{children}</a>;
  return <button type={type} onClick={onClick} className={cls} style={s}>{children}</button>;
};

export const Badge = ({ children, color = BRAND.papaya, soft = true }: { children: React.ReactNode; color?: string; soft?: boolean }) => (
  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
    style={soft ? { background: `${color}22`, color } : { background: color, color: '#fff' }}>{children}</span>
);

// Centered section header with a pill eyebrow.
export const SectionHeader = ({ t, eyebrow, title, subtitle, light }: {
  t: ThemeTokens; eyebrow?: string; title: string; subtitle?: string; light?: boolean;
}) => (
  <div className="text-center max-w-2xl mx-auto mb-10 md:mb-14 px-2">
    {eyebrow && (
      <span className="inline-block rounded-full px-4 py-1.5 text-xs font-semibold mb-4"
        style={{ background: light ? 'rgba(255,255,255,0.12)' : `${BRAND.papaya}14`, color: BRAND.papaya, border: `1px solid ${BRAND.papaya}33` }}>
        {eyebrow}
      </span>
    )}
    <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight" style={{ color: light ? '#fff' : t.tx, letterSpacing: '-0.02em' }}>{title}</h2>
    {subtitle && <p className="mt-3 text-sm md:text-base" style={{ color: light ? 'rgba(255,255,255,0.75)' : t.tx2 }}>{subtitle}</p>}
  </div>
);
