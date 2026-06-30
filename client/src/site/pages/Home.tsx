import { useNavigate } from 'react-router-dom';
import { Check, Star } from 'lucide-react';
import { m } from '../../design/motion';
import { FadeIn, ScrollReveal, Stagger, StaggerItem } from '../../design/motion';
import { GlassCard, Button, SectionHeader } from '../../design/ui';
import { BRAND, type ThemeTokens } from '../../design/tokens';
import { HeroIllustration } from '../HeroIllustration';
import { RevenueCalculator } from '../RevenueCalculator';
import { Icon } from '../icons';
import { FEATURES, BRANDS, PROOF } from '../content';

export default function Home({ t, dark }: { t: ThemeTokens; dark: boolean }) {
  const nav = useNavigate();
  return (
    <div>
      {/* HERO */}
      <section className="px-5 md:px-10 pt-10 md:pt-16 pb-12">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <FadeIn>
              <span className="inline-block rounded-full px-4 py-1.5 text-xs font-semibold mb-5" style={{ background: `${BRAND.papaya}14`, color: BRAND.papaya, border: `1px solid ${BRAND.papaya}33` }}>
                WhatsApp-first customer retention
              </span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05]" style={{ color: t.tx, letterSpacing: '-0.04em' }}>
                Bring customers<br />back <span style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>automatically.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.12}>
              <p className="mt-5 max-w-md text-base md:text-lg" style={{ color: t.tx2 }}>
                The Loyaly helps restaurants, cafés and local businesses track customers, reward loyalty and send comeback campaigns — before people quietly disappear.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => nav('/signup')}>Start free trial</Button>
                <Button variant="secondary" t={t} onClick={() => nav('/product')}>See how it works</Button>
              </div>
              <p className="mt-4 text-xs" style={{ color: t.tx3 }}>Built for cafés, restaurants, salons, barbers, gyms and local retail.</p>
            </FadeIn>
          </div>
          <FadeIn delay={0.1}><HeroIllustration t={t} dark={dark} /></FadeIn>
        </div>
      </section>

      {/* BRANDS marquee */}
      <section className="px-5 md:px-10 py-6">
        <div className="mx-auto max-w-6xl overflow-hidden">
          <p className="mb-4 text-center text-xs font-medium uppercase tracking-widest" style={{ color: t.tx3 }}>Loved by local businesses</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {BRANDS.map(b => <span key={b} className="text-sm font-semibold" style={{ color: t.tx2, opacity: 0.8 }}>{b}</span>)}
          </div>
        </div>
      </section>

      {/* CALCULATOR */}
      <section className="px-5 md:px-10 py-12">
        <SectionHeader t={t} eyebrow="Quick estimate" title="See your comeback revenue in 10 seconds" subtitle="A rough, honest estimate of the repeat revenue The Loyaly could help you bring back." />
        <ScrollReveal><RevenueCalculator t={t} dark={dark} /></ScrollReveal>
      </section>

      {/* FEATURE HIGHLIGHTS */}
      <section className="px-5 md:px-10 py-12">
        <SectionHeader t={t} eyebrow="Everything in one place" title="One system to keep customers coming back" subtitle="Loyalty, campaigns, automations and AI — built around WhatsApp, not bolted on." />
        <Stagger className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.slice(0, 8).map(f => (
            <StaggerItem key={f.title}>
              <GlassCard t={t} hover className="h-full p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl mb-3" style={{ background: `${BRAND.papaya}1f` }}><Icon name={f.icon} size={20} style={{ color: BRAND.papaya }} /></span>
                <h3 className="text-sm font-bold" style={{ color: t.tx }}>{f.title}</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: t.tx2 }}>{f.desc}</p>
              </GlassCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* PROOF */}
      <section className="px-5 md:px-10 py-12">
        <ScrollReveal className="mx-auto max-w-3xl">
          <GlassCard t={t} glow className="p-8 text-center">
            <div className="mb-3 flex justify-center gap-1">{[...Array(5)].map((_, i) => <Star key={i} size={18} fill={BRAND.warning} style={{ color: BRAND.warning }} />)}</div>
            <p className="text-lg md:text-xl font-semibold" style={{ color: t.tx }}>“{PROOF.quote}”</p>
            <p className="mt-4 text-sm" style={{ color: t.tx2 }}>{PROOF.name} · {PROOF.biz}</p>
          </GlassCard>
        </ScrollReveal>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-14">
        <m.div className="mx-auto max-w-4xl rounded-3xl p-10 text-center" style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})` }}>
          <h2 className="text-2xl md:text-3xl font-extrabold text-white" style={{ letterSpacing: '-0.02em' }}>Ready to turn visitors into regulars?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/85">Start your 14-day free trial. No credit card required.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => nav('/signup')} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold" style={{ color: BRAND.deep }}>Start free trial</button>
            <button onClick={() => nav('/pricing')} className="rounded-xl px-6 py-3 text-sm font-semibold text-white" style={{ border: '1px solid rgba(255,255,255,0.5)' }}>View pricing</button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-xs text-white/85">
            {['14-day free trial', 'No credit card', 'Cancel anytime'].map(l => <span key={l} className="flex items-center gap-1.5"><Check size={13} />{l}</span>)}
          </div>
        </m.div>
      </section>
    </div>
  );
}
