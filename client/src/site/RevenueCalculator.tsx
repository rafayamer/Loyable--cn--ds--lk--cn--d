// Game-like revenue estimator. Conservative, research-grounded (Bain; BIA/Kelsey)
// 8–15% uplift band on existing customer revenue. Clearly an estimate, not a promise.
import { useState } from 'react';
import { Button } from '../design/ui';
import { BRAND, type ThemeTokens } from '../design/tokens';
import { goAuth } from './MarketingNav';

export const RevenueCalculator = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => {
  const [customers, setCustomers] = useState(300);
  const [spend, setSpend] = useState(18);
  const [freq, setFreq] = useState(2);
  const base = customers * spend * freq;
  const fmt = (n: number) => '£' + Math.round(n).toLocaleString();
  const yr = (r: number) => base * r * 12;

  const Slider = ({ label, val, min, max, step, on, prefix }: any) => (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: t.tx2 }}>{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: t.tx }}>{prefix || ''}{val.toLocaleString()}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={e => on(Number(e.target.value))}
        className="w-full cursor-pointer appearance-none" style={{
          height: 6, borderRadius: 999, accentColor: BRAND.papaya,
          background: `linear-gradient(90deg,${BRAND.papaya} ${((val - min) / (max - min)) * 100}%, ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} ${((val - min) / (max - min)) * 100}%)`,
        }} />
    </div>
  );

  return (
    <div className="w-full max-w-md mx-auto rounded-3xl p-6 md:p-7" style={{ background: t.card, border: `1px solid ${t.bdr}`, boxShadow: t.shadow, backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)' }}>
      <span className="text-[10px] font-bold uppercase tracking-widest rounded-md px-2 py-1" style={{ background: `${BRAND.papaya}22`, color: BRAND.papaya }}>Revenue estimator</span>
      <h3 className="mt-3 text-lg md:text-xl font-bold" style={{ color: t.tx, letterSpacing: '-0.02em' }}>How much repeat revenue are you leaving on the table?</h3>
      <p className="mt-1 mb-5 text-xs" style={{ color: t.tx2 }}>Move the sliders to match your business.</p>
      <div className="space-y-4">
        <Slider label="Customers a month" val={customers} min={50} max={3000} step={10} on={setCustomers} />
        <Slider label="Average spend per visit" val={spend} min={5} max={150} step={1} on={setSpend} prefix="£" />
        <Slider label="Visits per customer / month" val={freq} min={1} max={8} step={1} on={setFreq} />
      </div>
      <div className="mt-6 rounded-2xl p-5 text-center" style={{ background: dark ? 'rgba(249,115,22,0.10)' : 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.25)' }}>
        <div className="text-xs font-medium" style={{ color: t.tx2 }}>Estimated extra revenue you could recover</div>
        <div className="mt-1 text-3xl md:text-4xl font-black" style={{ color: BRAND.papaya, letterSpacing: '-0.03em' }}>{fmt(yr(0.115))}<span className="text-base font-bold" style={{ color: t.tx2 }}> / year</span></div>
        <div className="mt-1 text-[11px]" style={{ color: t.tx2 }}>Range {fmt(yr(0.08))} – {fmt(yr(0.15))} a year</div>
      </div>
      <Button variant="primary" className="mt-4 w-full" onClick={() => goAuth('/signup')}>Start recovering it free →</Button>
      <p className="mt-3 text-[10px] leading-relaxed" style={{ color: t.tx2 }}>Estimate only, not a guarantee. Based on published retention research (Bain &amp; Company; BIA/Kelsey) applied as a conservative 8–15% uplift to your existing customer revenue.</p>
    </div>
  );
};
