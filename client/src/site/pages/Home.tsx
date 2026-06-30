import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, Star } from 'lucide-react';
import { m, FadeIn, ScrollReveal, Stagger, StaggerItem } from '../../design/motion';
import { Button, SectionHeader, Monogram, StatCounter, Marquee } from '../../design/ui';
import { BRAND, type ThemeTokens } from '../../design/tokens';
import { DashboardMock, CampaignMock, WalletMock } from '../../design/mockups';
import { RevenueCalculator } from '../RevenueCalculator';
import { goAuth } from '../MarketingNav';
import { BRANDS, PROOF, STATS } from '../content';

export default function Home({ t, dark }: { t: ThemeTokens; dark: boolean }) {
  const nav = useNavigate();

  const showcases = [
    { kicker: 'Know your customers', title: 'Every visit, captured automatically', body: 'A single QR check-in builds a living customer list — sorted into new, active, loyal, at-risk and lost, so you always know who needs attention.', mock: <DashboardMock t={t} dark={dark} />, reverse: false },
    { kicker: 'Win them back', title: 'Comeback campaigns that actually land', body: 'Reach the customers about to slip away with a personal WhatsApp offer. See exactly what was delivered, read and redeemed.', mock: <CampaignMock t={t} dark={dark} />, reverse: true },
    { kicker: 'Reward loyalty', title: 'A loyalty wallet they keep coming back to', body: 'Points, tiers and rewards in a beautiful digital card — no apps, no plastic. Regulars feel recognised, and they spend more.', mock: <WalletMock t={t} dark={dark} />, reverse: false },
  ];

  return (
    <div>
      {/* HERO */}
      <section className="relative mesh-warm grain overflow-hidden">
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 md:px-10 pt-12 md:pt-20 pb-16 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <FadeIn>
              <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold mb-6" style={{ background: t.card, color: BRAND.papaya, border: `1px solid ${t.bdr}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: BRAND.papaya }} />WhatsApp-first customer retention
              </span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="font-extrabold" style={{ color: t.tx, letterSpacing: '-0.045em', lineHeight: 1.02, fontSize: 'clamp(2.6rem,7vw,5rem)' }}>
                Bring customers<br />back <span style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>automatically.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.12}>
              <p className="mt-6 max-w-md text-base md:text-lg leading-relaxed" style={{ color: t.tx2 }}>
                The retention platform for restaurants, cafés and local businesses. Track every customer, reward loyalty, and recover quiet revenue — before people disappear.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => goAuth('/signup')}>Start free trial <ArrowRight size={16} /></Button>
                <Button variant="secondary" t={t} onClick={() => nav('/product')}>See how it works</Button>
              </div>
            </FadeIn>
            <FadeIn delay={0.28}>
              <div className="mt-7 flex items-center gap-3">
                <div className="flex -space-x-2.5">
                  {['Amara Patel', 'Deon Carter', 'Layla Hassan', 'Marcus Reid'].map(n => <Monogram key={n} name={n} size={32} />)}
                </div>
                <div className="text-xs" style={{ color: t.tx2 }}>
                  <span className="inline-flex items-center gap-0.5" style={{ color: BRAND.warning }}>{[...Array(5)].map((_, i) => <Star key={i} size={12} fill="currentColor" />)}</span>
                  <div>Trusted by local business owners</div>
                </div>
              </div>
            </FadeIn>
          </div>

          <FadeIn delay={0.15}>
            <m.div initial={dark ? false : undefined} animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="flex justify-center lg:justify-end">
              <DashboardMock t={t} dark={dark} />
            </m.div>
          </FadeIn>
        </div>
      </section>

      {/* STATS BAND */}
      <section className="px-5 md:px-10 py-12 border-y" style={{ borderColor: t.bdr }}>
        <Stagger className="mx-auto grid max-w-5xl grid-cols-2 gap-8 md:grid-cols-4">
          {STATS.map(s => (
            <StaggerItem key={s.label}><StatCounter t={t} value={s.value} prefix={s.prefix} suffix={s.suffix} label={s.label} decimals={s.decimals} /></StaggerItem>
          ))}
        </Stagger>
        <p className="mx-auto mt-6 max-w-md text-center text-[11px]" style={{ color: t.tx3 }}>Sample figures based on industry retention research — not a guarantee.</p>
      </section>

      {/* ALTERNATING SHOWCASES */}
      {showcases.map((s, i) => (
        <section key={s.title} className="px-5 md:px-10 py-16 md:py-24">
          <div className={`mx-auto grid max-w-6xl items-center gap-10 lg:gap-16 lg:grid-cols-2 ${s.reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
            <ScrollReveal>
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-4" style={{ color: BRAND.papaya }}>
                <span className="inline-block h-px w-6" style={{ background: BRAND.papaya }} />{s.kicker}
              </span>
              <h2 className="text-3xl md:text-[2.6rem] md:leading-[1.08] font-extrabold" style={{ color: t.tx, letterSpacing: '-0.03em' }}>{s.title}</h2>
              <p className="mt-4 text-base leading-relaxed max-w-md" style={{ color: t.tx2 }}>{s.body}</p>
              <button onClick={() => nav('/product')} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: BRAND.papaya }}>Learn more <ArrowRight size={15} /></button>
            </ScrollReveal>
            <ScrollReveal delay={0.1} className="flex justify-center">{s.mock}</ScrollReveal>
          </div>
        </section>
      ))}

      {/* CALCULATOR */}
      <section className="relative mesh-warm grain px-5 md:px-10 py-16">
        <div className="relative z-10">
          <SectionHeader t={t} eyebrow="Quick estimate" title="See your comeback revenue in 10 seconds" subtitle="An honest, conservative estimate of the repeat revenue The Loyaly could help you recover." />
          <ScrollReveal><RevenueCalculator t={t} dark={dark} /></ScrollReveal>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="px-5 md:px-10 py-12">
        <p className="mb-5 text-center text-xs font-bold uppercase tracking-widest" style={{ color: t.tx3 }}>Loved by local businesses</p>
        <Marquee items={BRANDS} t={t} />
      </section>

      {/* TESTIMONIAL */}
      <section className="px-5 md:px-10 py-12">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <div className="mb-4 flex justify-center gap-1">{[...Array(5)].map((_, i) => <Star key={i} size={18} fill={BRAND.warning} style={{ color: BRAND.warning }} />)}</div>
          <p className="text-xl md:text-2xl font-semibold leading-snug" style={{ color: t.tx, letterSpacing: '-0.01em' }}>“{PROOF.quote}”</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Monogram name={PROOF.name} size={40} />
            <div className="text-left"><div className="text-sm font-semibold" style={{ color: t.tx }}>{PROOF.name}</div><div className="text-xs" style={{ color: t.tx3 }}>{PROOF.biz}</div></div>
          </div>
        </ScrollReveal>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-16">
        <ScrollReveal className="mx-auto max-w-4xl rounded-[2rem] p-10 md:p-14 text-center relative overflow-hidden grain" style={{ background: `linear-gradient(135deg,${BRAND.burnt},${BRAND.papaya} 55%,${BRAND.light})` }}>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white" style={{ letterSpacing: '-0.03em' }}>Ready to turn visitors into regulars?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm md:text-base text-white/85">Start your 14-day free trial. No credit card required.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <button onClick={() => goAuth('/signup')} className="rounded-xl bg-white px-7 py-3 text-sm font-semibold transition-transform hover:scale-[1.03]" style={{ color: BRAND.deep }}>Start free trial</button>
            <button onClick={() => nav('/pricing')} className="rounded-xl px-7 py-3 text-sm font-semibold text-white" style={{ border: '1px solid rgba(255,255,255,0.5)' }}>View pricing</button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-5 text-xs text-white/85">
            {['14-day free trial', 'No credit card', 'Cancel anytime'].map(l => <span key={l} className="flex items-center gap-1.5"><Check size={13} />{l}</span>)}
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
