// ================================================================
//  Shared UI primitives — glassmorphic, papaya-branded, theme-aware.
//  Reused by the marketing site (and adoptable by CRM/portal/admin)
//  so every surface shares one component language.
// ================================================================
import React from 'react';
import { m, hoverLift, useCountUp } from './motion';
import { BRAND, GRAD, type ThemeTokens } from './tokens';

// Initials avatar in a gradient ring — the brand-safe replacement for emoji.
export const Monogram = ({ name, size = 40, color = BRAND.papaya }: { name: string; size?: number; color?: string }) => {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg,${color},${BRAND.deep})`, boxShadow: `0 6px 18px ${color}55` }}>
      {initials}
    </span>
  );
};

// Count-up statistic. `value` is the numeric target; prefix/suffix wrap it.
export const StatCounter = ({ t, value, prefix = '', suffix = '', label, decimals = 0 }: {
  t: ThemeTokens; value: number; prefix?: string; suffix?: string; label: string; decimals?: number;
}) => {
  const { ref, val } = useCountUp(value);
  return (
    <div className="text-center">
      <div ref={ref} className="text-3xl md:text-4xl font-black" style={{ color: t.tx, letterSpacing: '-0.03em' }}>
        {prefix}{val.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}
      </div>
      <div className="mt-1 text-xs md:text-sm" style={{ color: t.tx3 }}>{label}</div>
    </div>
  );
};

// Smooth, infinite logo/word marquee (duplicated track).
export const Marquee = ({ items, t }: { items: string[]; t: ThemeTokens }) => (
  <div className="relative overflow-hidden" style={{ maskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)' }}>
    <div className="flex w-max gap-12 lyl-marquee">
      {[...items, ...items].map((b, i) => <span key={i} className="text-sm font-semibold whitespace-nowrap" style={{ color: t.tx2, opacity: 0.7 }}>{b}</span>)}
    </div>
  </div>
);

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

// Section header — centered by default, or editorial left-aligned.
export const SectionHeader = ({ t, eyebrow, title, subtitle, light, align = 'center' }: {
  t: ThemeTokens; eyebrow?: string; title: string; subtitle?: string; light?: boolean; align?: 'center' | 'left';
}) => (
  <div className={`${align === 'center' ? 'text-center max-w-2xl mx-auto' : 'max-w-xl'} mb-10 md:mb-14 px-2`}>
    {eyebrow && (
      <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-4" style={{ color: BRAND.papaya }}>
        <span className="inline-block h-px w-6" style={{ background: BRAND.papaya }} />{eyebrow}
      </span>
    )}
    <h2 className="text-3xl md:text-[2.7rem] md:leading-[1.08] font-extrabold" style={{ color: light ? '#fff' : t.tx, letterSpacing: '-0.03em' }}>{title}</h2>
    {subtitle && <p className="mt-3 text-sm md:text-base leading-relaxed" style={{ color: light ? 'rgba(255,255,255,0.75)' : t.tx2 }}>{subtitle}</p>}
  </div>
);
