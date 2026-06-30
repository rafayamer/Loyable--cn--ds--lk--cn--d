// ================================================================
//  Product-UI mockups — realistic, brand-accurate app screens built in
//  pure CSS/SVG (no images). These are the centerpiece of the product-led
//  marketing site: a believable dashboard, a WhatsApp campaign preview,
//  and an Apple-Wallet-style loyalty card. Theme-aware via tokens `t`.
// ================================================================
import { BRAND, type ThemeTokens } from './tokens';
import { LayoutDashboard, Users, Send, BarChart3, Award, Search, Check, CheckCheck } from 'lucide-react';

const frame = (t: ThemeTokens, dark: boolean): React.CSSProperties => ({
  background: dark ? 'rgba(20,12,8,0.72)' : 'rgba(255,255,255,0.92)',
  border: `1px solid ${t.bdr}`,
  borderRadius: 18,
  boxShadow: t.shadow,
  backdropFilter: 'blur(18px) saturate(140%)',
  WebkitBackdropFilter: 'blur(18px) saturate(140%)',
  overflow: 'hidden',
});
const sub = (t: ThemeTokens, dark: boolean) => (dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,247,237,0.7)');

// ── Dashboard ───────────────────────────────────────────────────
export const DashboardMock = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => {
  const nav = [
    { icon: LayoutDashboard, on: true }, { icon: Users }, { icon: Send }, { icon: BarChart3 }, { icon: Award },
  ];
  const kpis = [
    { label: 'Active customers', value: '1,284', d: '+8.3%', up: true, c: BRAND.papaya },
    { label: 'Recovered revenue', value: '£8,420', d: '+18.7%', up: true, c: BRAND.success },
    { label: 'At risk', value: '142', d: '-5.1%', up: false, c: BRAND.warning },
  ];
  const bars = [42, 58, 36, 70, 52, 84, 66, 78, 60, 90, 74, 88];
  const rows = [
    { n: 'Amara Patel', s: 'VIP', c: BRAND.papaya, v: '£1,240' },
    { n: 'Deon Carter', s: 'Loyal', c: BRAND.success, v: '£860' },
    { n: 'Layla Hassan', s: 'At risk', c: BRAND.warning, v: '£430' },
  ];
  return (
    <div style={frame(t, dark)} className="w-full max-w-[560px] text-left">
      <div className="flex">
        {/* sidebar */}
        <div className="hidden xs:flex sm:flex flex-col items-center gap-3 py-4 px-2.5" style={{ background: sub(t, dark), borderRight: `1px solid ${t.bdr}` }}>
          <div className="h-7 w-7 rounded-lg" style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})` }} />
          {nav.map((n, i) => (
            <span key={i} className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: n.on ? `${BRAND.papaya}1f` : 'transparent' }}>
              <n.icon size={15} style={{ color: n.on ? BRAND.papaya : t.tx3 }} />
            </span>
          ))}
        </div>
        {/* main */}
        <div className="flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[13px] font-bold" style={{ color: t.tx }}>Dashboard</div>
              <div className="text-[9px]" style={{ color: t.tx3 }}>Last 30 days</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: sub(t, dark), border: `1px solid ${t.bdr}` }}>
              <Search size={10} style={{ color: t.tx3 }} /><span className="text-[9px]" style={{ color: t.tx3 }}>Search</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {kpis.map(k => (
              <div key={k.label} className="rounded-xl p-2.5" style={{ background: sub(t, dark), border: `1px solid ${t.bdr}` }}>
                <div className="text-[8px]" style={{ color: t.tx3 }}>{k.label}</div>
                <div className="text-[15px] font-extrabold leading-tight" style={{ color: t.tx }}>{k.value}</div>
                <div className="text-[8px] font-bold" style={{ color: k.up ? BRAND.success : BRAND.danger }}>{k.d}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-3 mb-3" style={{ background: sub(t, dark), border: `1px solid ${t.bdr}` }}>
            <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold" style={{ color: t.tx }}>Revenue</span><span className="text-[8px]" style={{ color: t.tx3 }}>weekly</span></div>
            <div className="flex items-end gap-1 h-16">
              {bars.map((b, i) => <span key={i} className="flex-1 rounded-t" style={{ height: `${b}%`, background: `linear-gradient(180deg,${BRAND.light},${BRAND.papaya})`, opacity: 0.55 + (b / 250) }} />)}
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${t.bdr}` }}>
            {rows.map((r, i) => (
              <div key={r.n} className="flex items-center gap-2 px-2.5 py-2" style={{ background: sub(t, dark), borderTop: i ? `1px solid ${t.bdr}` : 'none' }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: `linear-gradient(135deg,${r.c},${BRAND.deep})` }}>{r.n.split(' ').map(x => x[0]).join('')}</span>
                <span className="flex-1 text-[10px] font-medium" style={{ color: t.tx }}>{r.n}</span>
                <span className="rounded-md px-1.5 py-0.5 text-[8px] font-bold" style={{ background: `${r.c}22`, color: r.c }}>{r.s}</span>
                <span className="text-[10px] font-semibold tabular-nums" style={{ color: t.tx2 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── WhatsApp campaign preview ───────────────────────────────────
export const CampaignMock = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => (
  <div style={frame(t, dark)} className="w-full max-w-[360px] text-left">
    <div className="px-4 py-3" style={{ background: `linear-gradient(135deg,${BRAND.light},${BRAND.papaya})` }}>
      <div className="text-[11px] font-bold text-white">Win-back campaign</div>
      <div className="text-[9px] text-white/80">Audience · At-risk customers (142)</div>
    </div>
    <div className="p-4" style={{ background: dark ? 'rgba(11,20,16,0.6)' : '#ECE5DD' }}>
      <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-sm px-3 py-2 mb-2" style={{ background: dark ? '#075E54' : '#DCF8C6' }}>
        <div className="text-[11px]" style={{ color: dark ? '#fff' : '#111' }}>Hi Layla, we miss you at Casa Bistro. Here's a free coffee on your next visit.</div>
        <div className="mt-1 flex items-center justify-end gap-1"><span className="text-[8px]" style={{ color: dark ? 'rgba(255,255,255,0.6)' : '#667781' }}>09:24</span><CheckCheck size={11} style={{ color: '#34B7F1' }} /></div>
      </div>
      <div className="ml-auto max-w-[60%] rounded-2xl rounded-tr-sm px-3 py-2" style={{ background: dark ? '#075E54' : '#DCF8C6' }}>
        <div className="rounded-lg px-2 py-1 text-center text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.06)', color: dark ? '#fff' : '#075E54' }}>Claim my free coffee</div>
        <div className="mt-1 flex items-center justify-end gap-1"><span className="text-[8px]" style={{ color: dark ? 'rgba(255,255,255,0.6)' : '#667781' }}>09:24</span><CheckCheck size={11} style={{ color: '#34B7F1' }} /></div>
      </div>
    </div>
    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: dark ? 'rgba(20,12,8,0.72)' : '#fff', borderTop: `1px solid ${t.bdr}` }}>
      <span className="text-[9px]" style={{ color: t.tx3 }}>Delivered 138 · Read 121</span>
      <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: BRAND.success }}><Check size={10} />87% read</span>
    </div>
  </div>
);

// ── Loyalty wallet card ─────────────────────────────────────────
export const WalletMock = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => (
  <div className="w-full max-w-[340px] text-left">
    <div className="rounded-3xl p-5 text-white relative overflow-hidden" style={{ background: `linear-gradient(145deg,${BRAND.burnt},${BRAND.papaya} 60%,${BRAND.light})`, boxShadow: '0 24px 60px rgba(249,115,22,0.35)' }}>
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wide">CASA BISTRO</span>
        <Award size={18} />
      </div>
      <div className="mt-6 text-[10px] uppercase tracking-widest text-white/70">Loyalty points</div>
      <div className="text-3xl font-black">2,480</div>
      <div className="mt-4 flex items-center justify-between">
        <div><div className="text-[9px] text-white/70">Member</div><div className="text-[12px] font-semibold">Amara Patel</div></div>
        {/* faux QR */}
        <div className="grid grid-cols-5 gap-0.5 rounded-lg bg-white p-1.5">
          {Array.from({ length: 25 }).map((_, i) => <span key={i} className="h-1.5 w-1.5 rounded-[1px]" style={{ background: [0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 16, 18, 20, 22, 23, 24, 6, 8, 17].includes(i) ? '#111' : 'transparent' }} />)}
        </div>
      </div>
    </div>
    <div className="mt-3 rounded-2xl p-3" style={{ background: t.card, border: `1px solid ${t.bdr}`, boxShadow: t.shadow }}>
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: t.tx2 }}>Next reward</span><span className="font-bold" style={{ color: t.tx }}>Free dessert</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
        <div className="h-2 rounded-full" style={{ width: '72%', background: `linear-gradient(90deg,${BRAND.light},${BRAND.papaya})` }} />
      </div>
      <div className="mt-1 text-[9px]" style={{ color: t.tx3 }}>520 points to go</div>
    </div>
  </div>
);
