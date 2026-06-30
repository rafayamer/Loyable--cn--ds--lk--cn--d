import { FadeIn, ScrollReveal, Stagger, StaggerItem } from '../../design/motion';
import { GlassCard, Button, SectionHeader } from '../../design/ui';
import { BRAND, type ThemeTokens } from '../../design/tokens';
import { Icon } from '../icons';
import { goAuth } from '../MarketingNav';
import { FEATURES, STEPS, INDUSTRIES } from '../content';

export default function Product({ t }: { t: ThemeTokens; dark: boolean }) {
  return (
    <div className="px-5 md:px-10">
      <section className="pt-10 md:pt-16 pb-6 text-center">
        <FadeIn>
          <span className="inline-block rounded-full px-4 py-1.5 text-xs font-semibold mb-5" style={{ background: `${BRAND.papaya}14`, color: BRAND.papaya, border: `1px solid ${BRAND.papaya}33` }}>The product</span>
          <h1 className="mx-auto max-w-3xl text-4xl md:text-5xl font-extrabold" style={{ color: t.tx, letterSpacing: '-0.03em' }}>Everything you need to keep customers coming back</h1>
          <p className="mx-auto mt-4 max-w-xl text-base" style={{ color: t.tx2 }}>Capture, segment, reward and win back — all from one calm, WhatsApp-first platform.</p>
        </FadeIn>
      </section>

      {/* How it works */}
      <section className="py-12">
        <SectionHeader t={t} eyebrow="How it works" title="From first visit to loyal regular" />
        <Stagger className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(s => (
            <StaggerItem key={s.n}>
              <GlassCard t={t} className="h-full p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white mb-3" style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})` }}>{s.n}</span>
                <h3 className="text-sm font-bold" style={{ color: t.tx }}>{s.title}</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: t.tx2 }}>{s.desc}</p>
              </GlassCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Full feature grid */}
      <section className="py-12">
        <SectionHeader t={t} eyebrow="Features" title="One platform, everything included" />
        <Stagger className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(f => (
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

      {/* Industries */}
      <section className="py-12">
        <SectionHeader t={t} eyebrow="Who it's for" title="Built for local businesses" />
        <Stagger className="mx-auto grid max-w-4xl gap-4 grid-cols-2 sm:grid-cols-3">
          {INDUSTRIES.map(i => (
            <StaggerItem key={i.label}>
              <GlassCard t={t} hover className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${BRAND.papaya}1f` }}><Icon name={i.icon} size={18} style={{ color: BRAND.papaya }} /></span>
                <span className="text-sm font-semibold" style={{ color: t.tx }}>{i.label}</span>
              </GlassCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <ScrollReveal className="py-14 text-center">
        <Button variant="primary" onClick={() => goAuth('/signup')}>Start free trial →</Button>
      </ScrollReveal>
    </div>
  );
}
