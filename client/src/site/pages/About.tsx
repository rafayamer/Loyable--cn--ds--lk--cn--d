import { useNavigate } from 'react-router-dom';
import { Heart, Target, Sparkles } from 'lucide-react';
import { FadeIn, ScrollReveal, Stagger, StaggerItem } from '../../design/motion';
import { GlassCard, Button, SectionHeader } from '../../design/ui';
import { BRAND, type ThemeTokens } from '../../design/tokens';
import { STORIES } from '../content';

export default function About({ t }: { t: ThemeTokens; dark: boolean }) {
  const nav = useNavigate();
  const values = [
    { icon: Heart, title: 'Built for owners', desc: 'For non-technical business owners — simple, warm and genuinely useful from day one.' },
    { icon: Target, title: 'Honest by design', desc: 'No fake guarantees or vanity metrics. Real data, clear answers, your customers respected.' },
    { icon: Sparkles, title: 'WhatsApp-first', desc: 'Loyalty, campaigns and automations built around the channel your customers already use.' },
  ];
  return (
    <div className="px-5 md:px-10">
      <section className="pt-10 md:pt-16 pb-8 text-center">
        <FadeIn>
          <span className="inline-block rounded-full px-4 py-1.5 text-xs font-semibold mb-5" style={{ background: `${BRAND.papaya}14`, color: BRAND.papaya, border: `1px solid ${BRAND.papaya}33` }}>Our story</span>
          <h1 className="mx-auto max-w-3xl text-4xl md:text-5xl font-extrabold" style={{ color: t.tx, letterSpacing: '-0.03em' }}>We help local businesses remember every customer</h1>
          <p className="mx-auto mt-4 max-w-xl text-base" style={{ color: t.tx2 }}>The Loyaly started with a simple belief: small businesses shouldn’t lose customers just because they couldn’t track who stopped coming. So we built the comeback system big chains have — made for the corner café, the neighbourhood salon, the local gym.</p>
        </FadeIn>
      </section>

      <section className="py-10">
        <Stagger className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {values.map(v => (
            <StaggerItem key={v.title}>
              <GlassCard t={t} className="h-full p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl mb-3" style={{ background: `${BRAND.papaya}1f` }}><v.icon size={20} style={{ color: BRAND.papaya }} /></span>
                <h3 className="text-base font-bold" style={{ color: t.tx }}>{v.title}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: t.tx2 }}>{v.desc}</p>
              </GlassCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="py-12">
        <SectionHeader t={t} eyebrow="Comeback stories" title="Real businesses, real regulars" />
        <Stagger className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {STORIES.map(s => (
            <StaggerItem key={s.biz}>
              <GlassCard t={t} hover className="h-full p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{s.emoji}</span>
                  <div><div className="text-sm font-bold" style={{ color: t.tx }}>{s.biz}</div><div className="text-xs" style={{ color: t.tx3 }}>{s.owner} · {s.city}</div></div>
                </div>
                <div className="mb-2 text-2xl font-black" style={{ color: BRAND.papaya }}>{s.stat} <span className="text-xs font-medium" style={{ color: t.tx3 }}>{s.statLabel}</span></div>
                <p className="text-sm leading-relaxed" style={{ color: t.tx2 }}>{s.story}</p>
              </GlassCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <ScrollReveal className="py-14 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold mb-4" style={{ color: t.tx, letterSpacing: '-0.02em' }}>Write your comeback story</h2>
        <Button variant="primary" onClick={() => nav('/signup')}>Start free trial →</Button>
      </ScrollReveal>
    </div>
  );
}
