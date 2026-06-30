import { useState } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { FadeIn, ScrollReveal, Stagger, StaggerItem } from '../../design/motion';
import { GlassCard, Button, SectionHeader } from '../../design/ui';
import { BRAND, type ThemeTokens } from '../../design/tokens';
import { goAuth } from '../MarketingNav';
import { PLANS, FAQS } from '../content';

export default function Pricing({ t }: { t: ThemeTokens; dark: boolean }) {
  const [yearly, setYearly] = useState(false);
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="px-5 md:px-10">
      <section className="pt-10 md:pt-16 pb-8 text-center">
        <FadeIn>
          <h1 className="mx-auto max-w-2xl text-4xl md:text-5xl font-extrabold" style={{ color: t.tx, letterSpacing: '-0.03em' }}>Simple pricing that grows with you</h1>
          <p className="mx-auto mt-4 max-w-lg text-base" style={{ color: t.tx2 }}>Start free for 14 days. No credit card required. Cancel anytime — your data is always kept.</p>
          <div className="mt-6 inline-flex items-center gap-1 rounded-xl p-1" style={{ background: t.bg2, border: `1px solid ${t.bdr}` }}>
            {[['Monthly', false], ['Yearly', true]].map(([label, val]) => (
              <button key={label as string} onClick={() => setYearly(val as boolean)}
                className="rounded-lg px-5 py-2 text-sm font-semibold transition-all"
                style={yearly === val ? { background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})`, color: '#fff' } : { color: t.tx2 }}>
                {label as string}{val ? ' · save 20%' : ''}
              </button>
            ))}
          </div>
        </FadeIn>
      </section>

      <Stagger className="mx-auto grid max-w-6xl gap-5 md:grid-cols-2 lg:grid-cols-4 pb-8">
        {PLANS.map(p => {
          const price = yearly ? p.yearly : p.monthly;
          return (
            <StaggerItem key={p.name}>
              <GlassCard t={t} hover noClip glow={p.highlight} className="relative h-full flex flex-col p-6" style={p.highlight ? { border: `2px solid ${BRAND.papaya}` } : {}}>
                {p.highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md px-2.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})` }}><Sparkles size={10} className="inline mr-1" />Most popular</span>}
                <h3 className="text-lg font-bold" style={{ color: t.tx }}>{p.name}</h3>
                <div className="mt-1 text-3xl font-black" style={{ color: t.tx }}>£{price}<span className="text-sm font-normal" style={{ color: t.tx3 }}>/mo</span></div>
                <p className="mt-1 mb-4 text-xs" style={{ color: t.tx3 }}>{p.desc}</p>
                <ul className="mb-6 space-y-2 flex-1">
                  {p.features.map(f => <li key={f} className="flex gap-2 text-xs" style={{ color: t.tx2 }}><Check size={14} style={{ color: BRAND.success, flexShrink: 0, marginTop: 1 }} />{f}</li>)}
                </ul>
                <Button variant={p.highlight ? 'primary' : 'secondary'} t={t} className="w-full" onClick={() => goAuth('/signup')}>{p.cta}</Button>
              </GlassCard>
            </StaggerItem>
          );
        })}
      </Stagger>
      <p className="mx-auto max-w-2xl text-center text-[11px] pb-6" style={{ color: t.tx3 }}>Prices in GBP. Checkout is completed securely inside your account. Your customers, campaigns and loyalty data are always preserved, even if you downgrade.</p>

      {/* FAQ */}
      <section className="py-12">
        <SectionHeader t={t} eyebrow="FAQ" title="Questions, answered" />
        <div className="mx-auto max-w-2xl">
          {FAQS.map((f, i) => (
            <ScrollReveal key={f.q}>
              <div className="cursor-pointer border-b py-4" style={{ borderColor: t.bdr }} onClick={() => setOpen(open === i ? null : i)}>
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold" style={{ color: t.tx }}>{f.q}</h3>
                  <ChevronDown size={18} style={{ color: t.tx2, transform: open === i ? 'rotate(180deg)' : 'none', transition: 'transform .3s', flexShrink: 0 }} />
                </div>
                <div style={{ maxHeight: open === i ? 240 : 0, overflow: 'hidden', transition: 'max-height .4s ease, opacity .3s', opacity: open === i ? 1 : 0 }}>
                  <p className="pt-3 text-sm leading-relaxed" style={{ color: t.tx2 }}>{f.a}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>
    </div>
  );
}
