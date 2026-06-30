// ================================================================
//  HeroIllustration — ONE clean illustration that conveys the whole
//  product: a central "customer comeback" dashboard card surrounded by
//  orbiting feature glyphs (QR, points, campaign, analytics). Lightweight
//  inline SVG + glass. Gentle float/parallax, disabled under reduced-motion.
// ================================================================
import { m, useReducedMotion } from '../design/motion';
import { BRAND, type ThemeTokens } from '../design/tokens';
import { QrCode, Award, Send, BarChart3, Heart, Users } from 'lucide-react';

const float = (delay = 0) => ({
  animate: { y: [0, -10, 0] },
  transition: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay },
});

export const HeroIllustration = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => {
  const reduce = useReducedMotion();
  const f = (d?: number) => (reduce ? {} : float(d));
  const glassStyle: React.CSSProperties = {
    background: t.card, border: `1px solid ${t.bdr}`,
    backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
    boxShadow: t.shadow,
  };
  const chip = (icon: React.ReactNode, label: string, value: string, color: string) => (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)', border: `1px solid ${t.bdr}` }}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>{icon}</span>
      <span className="flex-1"><span className="block text-[10px]" style={{ color: t.tx3 }}>{label}</span><span className="block text-sm font-bold" style={{ color: t.tx }}>{value}</span></span>
    </div>
  );

  return (
    <div className="relative mx-auto w-full max-w-[440px] aspect-square select-none">
      {/* warm ambient glow */}
      <div className="absolute inset-0 -z-10" style={{ background: `radial-gradient(circle at 50% 45%, ${BRAND.papaya}26 0%, transparent 65%)`, filter: 'blur(30px)' }} />

      {/* central dashboard card */}
      <m.div className="absolute left-1/2 top-1/2 w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-5" style={glassStyle} {...f(0)}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold" style={{ color: t.tx }}>Customer comeback</span>
          <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: `${BRAND.papaya}22`, color: BRAND.papaya }}>Live</span>
        </div>
        <div className="space-y-2">
          {chip(<Users size={15} />, 'Active customers', '1,284', BRAND.papaya)}
          {chip(<Heart size={15} />, 'Recovered revenue', '£8,420', BRAND.success)}
          {chip(<Send size={15} />, 'Comeback sent', '320', BRAND.light)}
        </div>
        <div className="mt-3 flex items-end gap-1.5 h-12">
          {[40, 55, 35, 70, 60, 85, 75].map((h, i) => (
            <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(180deg,${BRAND.light},${BRAND.papaya})`, opacity: 0.85 }} />
          ))}
        </div>
        <p className="mt-1 text-[10px]" style={{ color: t.tx3 }}>Sample data</p>
      </m.div>

      {/* orbiting glyphs */}
      <m.div className="absolute left-[4%] top-[14%] flex h-14 w-14 items-center justify-center rounded-2xl" style={glassStyle} {...f(0.4)}>
        <QrCode size={24} style={{ color: BRAND.papaya }} />
      </m.div>
      <m.div className="absolute right-[3%] top-[22%] flex h-14 w-14 items-center justify-center rounded-2xl" style={glassStyle} {...f(0.9)}>
        <Award size={24} style={{ color: BRAND.light }} />
      </m.div>
      <m.div className="absolute bottom-[12%] left-[8%] flex h-14 w-14 items-center justify-center rounded-2xl" style={glassStyle} {...f(1.3)}>
        <BarChart3 size={24} style={{ color: BRAND.success }} />
      </m.div>
      <m.div className="absolute bottom-[8%] right-[7%] flex h-14 w-14 items-center justify-center rounded-2xl" style={glassStyle} {...f(0.7)}>
        <Send size={22} style={{ color: BRAND.papaya }} />
      </m.div>
    </div>
  );
};
