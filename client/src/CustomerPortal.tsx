import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api/index';

// Plain fetch for portal public endpoints — avoids the auth wrapper's
// redirect-to-/ behaviour which would kick customers off on mobile.
const portalGet = (path: string) =>
  fetch(`/api${path}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

// ── Icons (inline SVG) ────────────────────────────────────────────
const Icon = {
  star:   () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  gift:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M20 12v10H4V12M22 7H2v5h20V7zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
  clock:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  share:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>,
  check:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4"><path d="M20 6L9 17l-5-5"/></svg>,
  copy:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  phone:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.22 1.18 2 2 0 012.22 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>,
  user:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  wifi:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>,
  menu:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>,
  info:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  eye:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
};

// ── Tier colour map ───────────────────────────────────────────────
const TIER_GRADIENT: Record<string, string> = {
  Bronze:   'linear-gradient(135deg,#cd7f32,#a0522d)',
  Silver:   'linear-gradient(135deg,#c0c0c0,#808080)',
  Gold:     'linear-gradient(135deg,#ffd700,#b8860b)',
  Platinum: 'linear-gradient(135deg,#e5e4e2,#9ea3a8)',
  Diamond:  'linear-gradient(135deg,#b9f2ff,#4fb3d1)',
};
function tierGrad(name?: string) {
  return name ? (TIER_GRADIENT[name] ?? 'linear-gradient(135deg,#8b5cf6,#7c3aed)') : 'linear-gradient(135deg,#8b5cf6,#7c3aed)';
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtCurrency(v: number, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

// ── Slug extraction from URL ──────────────────────────────────────
function getSlug(): string {
  const parts = window.location.pathname.split('/');
  const idx = parts.indexOf('portal');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : '';
}

// ── LocalStorage helpers for portal session ───────────────────────
const STORAGE_KEY = 'loyable_portal';
function saveSession(slug: string, token: string, name: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ slug, token, name, ts: Date.now() }));
}
function loadSession(slug: string) {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (s.slug === slug && s.token && Date.now() - s.ts < 7 * 86400 * 1000) return s;
  } catch {}
  return null;
}
function clearSession() { localStorage.removeItem(STORAGE_KEY); }

// ================================================================
// LOGIN SCREEN
// ================================================================
function LoginScreen({ slug, bizName, portalSettings, onLogin }: { slug: string; bizName: string; portalSettings: any; onLogin: (token: string, name: string) => void }) {
  const [phone, setPhone] = useState('');
  const [name,  setName]  = useState('');
  const [err,   setErr]   = useState('');
  const [loading, setLoading] = useState(false);
  const ps = portalSettings ?? {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${slug}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name }),
      }).then(r => r.json());
      if (!res.token) throw new Error(res.error ?? 'Login failed');
      saveSession(slug, res.token, res.customer.name);
      onLogin(res.token, res.customer.name);
    } catch (e: any) {
      setErr(e.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(160deg,#1e0a3c 0%,#2d1052 50%,#3d1a6e 100%)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6">
          <img src="/logo.svg" alt="Loyable" className="w-28 h-28 object-contain mx-auto mb-4"/>
          <h1 className="text-white font-black text-2xl">{bizName}</h1>
          <p className="text-purple-300 text-sm mt-1">Your Loyalty Rewards</p>
        </div>

        {/* Announcement banner (public, shown before login too) */}
        {ps.showAnnouncement && ps.announcementText && (
          <div className="mb-4 px-4 py-3 rounded-2xl text-sm text-white" style={{ background: 'rgba(139,92,246,0.3)', border: '1px solid rgba(139,92,246,0.5)' }}>
            📢 {ps.announcementText}
          </div>
        )}

        {/* WiFi info (public) */}
        {ps.showWifi && (ps.wifiName || ps.wifiPassword) && (
          <div className="mb-4 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <div className="flex items-center gap-2 text-white mb-2">
              <Icon.wifi/><span className="font-bold text-sm">Free WiFi</span>
            </div>
            {ps.wifiName && <p className="text-purple-200 text-xs">Network: <span className="font-mono font-bold text-white">{ps.wifiName}</span></p>}
            {ps.wifiPassword && <p className="text-purple-200 text-xs mt-0.5">Password: <span className="font-mono font-bold text-white">{ps.wifiPassword}</span></p>}
          </div>
        )}

        <div className="rounded-3xl p-6" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)' }}>
          <h2 className="text-white font-bold text-lg mb-1">Check your rewards</h2>
          <p className="text-purple-200 text-sm mb-5">Enter your phone number and first name to view your loyalty account.</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-purple-200 text-xs font-semibold mb-1.5 uppercase tracking-wide">Phone Number</label>
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
                <Icon.phone />
                <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 900000" required autoComplete="tel" className="flex-1 bg-transparent text-white placeholder-purple-400 outline-none text-sm"/>
              </div>
            </div>
            <div>
              <label className="block text-purple-200 text-xs font-semibold mb-1.5 uppercase tracking-wide">First Name</label>
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
                <Icon.user />
                <input type="text" inputMode="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your first name" required autoComplete="given-name" className="flex-1 bg-transparent text-white placeholder-purple-400 outline-none text-sm"/>
              </div>
            </div>
            {err && <div className="px-4 py-3 rounded-2xl text-sm" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>{err}</div>}
            <button type="submit" disabled={loading} className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-opacity disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
              {loading ? 'Checking...' : 'View My Rewards →'}
            </button>
          </form>
        </div>
        <p className="text-center text-purple-400 text-xs mt-6">Powered by Loyable · Your data is secure</p>
      </div>
    </div>
  );
}

// ================================================================
// LOYALTY CARD
// ================================================================
function LoyaltyCard({ customer, nextTier, progressToNext }: any) {
  const grad = tierGrad(customer.tier);
  return (
    <div className="rounded-3xl p-5 text-white relative overflow-hidden" style={{ background: grad, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}/>
      <div className="absolute -bottom-12 -left-8 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}/>
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-0.5">Loyalty Card</p>
            <p className="font-black text-lg leading-tight">{customer.name}</p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-0.5">Tier</p>
            <p className="font-black text-base">{customer.tier ?? 'Member'}</p>
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-white/70 text-xs mb-0.5">Points Balance</p>
            <p className="font-black text-4xl leading-none">{(customer.pointsBalance ?? 0).toLocaleString()}</p>
            <p className="text-white/60 text-xs mt-0.5">pts</p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs mb-0.5">Total Visits</p>
            <p className="font-black text-2xl">{customer.totalVisits ?? 0}</p>
          </div>
        </div>
        {nextTier && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-white/70 mb-1">
              <span>{progressToNext}% to {nextTier.name}</span>
              <span>{nextTier.minPoints - (customer.pointsBalance ?? 0)} pts needed</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <div className="h-full rounded-full" style={{ background: 'rgba(255,255,255,0.9)', width: `${progressToNext}%`, transition: 'width 1s ease' }}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// TAB: MENU
// ================================================================
function MenuTab({ menuImageUrl }: { menuImageUrl: string }) {
  const [zoomed, setZoomed] = useState(false);
  const isPdf = menuImageUrl.toLowerCase().includes('.pdf');

  if (isPdf) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="text-5xl">📄</div>
        <p className="text-sm text-slate-600 text-center">Our menu is available as a PDF</p>
        <a
          href={menuImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-3 rounded-2xl text-white text-sm font-semibold"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
        >
          Open Menu PDF
        </a>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 text-center">Tap image to zoom</p>
      <div
        className={`rounded-2xl overflow-hidden cursor-zoom-in transition-all ${zoomed ? 'fixed inset-2 z-50 cursor-zoom-out rounded-3xl' : ''}`}
        style={zoomed ? { background: 'rgba(0,0,0,0.9)' } : { border: '1px solid #f1f5f9' }}
        onClick={() => setZoomed(z => !z)}
      >
        {zoomed && <div className="absolute inset-0 bg-black/80 z-0" onClick={() => setZoomed(false)}/>}
        <img
          src={menuImageUrl}
          alt="Menu"
          className={`w-full object-contain ${zoomed ? 'max-h-screen relative z-10' : 'max-h-[70vh]'}`}
        />
      </div>
    </div>
  );
}

// ================================================================
// TAB: REWARDS
// ================================================================
function RewardsTab({ coupons, onRedeem, currency }: any) {
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemed,  setRedeemed]  = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');

  async function handleRedeem(code: string) {
    setRedeeming(code);
    setErr('');
    try {
      await onRedeem(code);
      setRedeemed(prev => new Set([...prev, code]));
    } catch (e: any) {
      setErr(e.message ?? 'Redemption failed');
    } finally {
      setRedeeming(null);
    }
  }

  if (!coupons?.length) return (
    <div className="text-center py-12">
      <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}>
        <span className="text-3xl">🎁</span>
      </div>
      <p className="text-slate-500 font-medium">No rewards yet</p>
      <p className="text-slate-400 text-sm mt-1">Keep visiting to earn rewards!</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {err && <div className="px-4 py-3 rounded-2xl text-sm text-red-600" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>{err}</div>}
      {coupons.map((c: any) => (
        <div key={c.id} className={`rounded-2xl p-4 border transition-all ${redeemed.has(c.code) ? 'opacity-50' : ''}`} style={{ background: redeemed.has(c.code) ? '#f9fafb' : 'white', border: redeemed.has(c.code) ? '1px solid #e5e7eb' : '1px solid rgba(139,92,246,0.2)' }}>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
              <span className="text-white font-black text-lg">
                {c.type === 'PERCENTAGE_DISCOUNT' ? `${c.value}%` : c.type === 'FREE_PRODUCT' ? 'Free' : fmtCurrency(Number(c.value ?? 0), currency)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 text-sm">{c.freeProductName || (c.type === 'PERCENTAGE_DISCOUNT' ? `${c.value}% off` : c.type === 'FREE_PRODUCT' ? 'Free item' : `${fmtCurrency(Number(c.value ?? 0), currency)} off`)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Code: <span className="font-mono font-bold text-purple-600">{c.code}</span></p>
              {c.expiresAt && <p className="text-xs text-slate-400 mt-0.5">Expires {fmt(c.expiresAt)}</p>}
            </div>
            {redeemed.has(c.code)
              ? <div className="flex items-center gap-1 text-green-600 text-xs font-semibold"><Icon.check/> Used</div>
              : <button onClick={() => handleRedeem(c.code)} disabled={!!redeeming} className="text-xs font-bold px-3 py-1.5 rounded-xl text-white transition-opacity disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
                  {redeeming === c.code ? '...' : 'Redeem'}
                </button>
            }
          </div>
        </div>
      ))}
    </div>
  );
}

// ================================================================
// TAB: VISIT HISTORY
// ================================================================
function VisitsTab({ visits, currency }: any) {
  if (!visits?.length) return (
    <div className="text-center py-12">
      <span className="text-4xl block mb-3">📋</span>
      <p className="text-slate-500 font-medium">No visits yet</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {visits.map((v: any) => (
        <div key={v.id} className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
            <span className="text-white text-lg">✓</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-700">{fmt(v.visitedAt)}</p>
            {v.spend > 0 && <p className="text-xs text-slate-500">Spent {fmtCurrency(v.spend / 100, currency)}</p>}
          </div>
          <div className="text-right">
            <p className="font-bold text-purple-600 text-sm">+{v.pointsEarned}</p>
            <p className="text-xs text-slate-400">pts</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ================================================================
// TAB: REFERRALS
// ================================================================
function ReferralTab({ customer, referralCount, bizName }: any) {
  const [copied, setCopied] = useState(false);
  const referralUrl = `${window.location.origin}/portal/${window.location.pathname.split('/')[2]}?ref=${customer.referralCode}`;

  function copy() {
    navigator.clipboard.writeText(referralUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl p-5 text-center" style={{ background: 'linear-gradient(135deg,#1e0a3c,#3d1a6e)', color: 'white' }}>
        <div className="text-4xl mb-2">🎉</div>
        <h3 className="font-black text-xl mb-1">Refer Friends</h3>
        <p className="text-purple-200 text-sm">Share your code and earn bonus points when friends join!</p>
        <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.1)' }}>
          <span className="flex-1 font-mono font-bold text-white text-sm truncate">{customer.referralCode}</span>
          <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background: copied ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.2)' }}>
            {copied ? <><Icon.check/> Copied!</> : <><Icon.copy/> Copy</>}
          </button>
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
            <span className="text-white font-black text-xl">{referralCount}</span>
          </div>
          <div>
            <p className="font-bold text-slate-800">Friends Referred</p>
            <p className="text-sm text-slate-500">Thank you for spreading the word!</p>
          </div>
        </div>
      </div>
      <button
        onClick={() => navigator.share?.({ title: `Join ${bizName} loyalty!`, text: `Use my referral code to join the loyalty program!`, url: referralUrl })}
        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}
      >
        <Icon.share /> Share My Code
      </button>
    </div>
  );
}

// ================================================================
// CUSTOM SECTION (info cards configured by business)
// ================================================================
function CustomSectionCard({ section }: { section: any }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
      <div className="flex items-start gap-3">
        {section.icon && <span className="text-2xl flex-shrink-0">{section.icon}</span>}
        <div>
          <p className="font-bold text-slate-800 text-sm mb-1">{section.title}</p>
          <p className="text-slate-600 text-sm whitespace-pre-wrap">{section.body}</p>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// MAIN DASHBOARD
// ================================================================
function Dashboard({ token, bizName, currency, portalSettings, checkInConfig, onLogout }: {
  token: string; bizName: string; currency: string; portalSettings: any;
  checkInConfig: { enabled: boolean; radiusMeters: number }; onLogout: () => void;
}) {
  const [data,        setData]        = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<string>(()=>localStorage.getItem('portal_tab')?? 'rewards');
  const switchTab = (id: string) => { setTab(id); localStorage.setItem('portal_tab', id); };
  const [err,         setErr]         = useState('');
  const [checkingIn,  setCheckingIn]  = useState(false);
  const [checkInMsg,  setCheckInMsg]  = useState<{ ok: boolean; text: string } | null>(null);
  const ps = portalSettings ?? {};

  const portalFetch = useCallback((path: string, init: RequestInit = {}) =>
    fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      return d;
    }), [token]);

  const handleCheckIn = async () => {
    setCheckingIn(true);
    setCheckInMsg(null);
    if (!navigator.geolocation) {
      setCheckInMsg({ ok: false, text: 'Geolocation is not supported by your browser' });
      setCheckingIn(false); return;
    }
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const r = await portalFetch('/portal/checkin', {
          method: 'POST',
          body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        });
        setCheckInMsg({ ok: true, text: `✓ Checked in! +${r.pointsEarned ?? 0} pts (${r.distanceMetres ?? 0} m away)` });
        load();
      } catch (e: any) {
        if (e.message === 'TOO_FAR') setCheckInMsg({ ok: false, text: `You're too far from this location to check in` });
        else if (e.message === 'ALREADY_CHECKED_IN_TODAY') setCheckInMsg({ ok: false, text: "You've already checked in today" });
        else setCheckInMsg({ ok: false, text: e.message ?? 'Check-in failed' });
      } finally { setCheckingIn(false); }
    }, () => {
      setCheckInMsg({ ok: false, text: 'Location permission denied. Please allow location access.' });
      setCheckingIn(false);
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const load = useCallback(async () => {
    try {
      const d = await portalFetch('/portal/me');
      setData(d);
    } catch (e: any) {
      if (e.message?.includes('expired') || e.message?.includes('Invalid') || e.message?.includes('401')) {
        clearSession();
        onLogout();
      } else {
        setErr(e.message ?? 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, [portalFetch]);

  useEffect(() => { load(); }, [load]);

  async function handleRedeem(couponCode: string) {
    await portalFetch('/portal/redeem', { method: 'POST', body: JSON.stringify({ couponCode }) });
    load();
  }

  if (loading) return (
    <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#f8fafc' }}>
      <div className="text-center">
        <img src="/logo.svg" alt="" className="w-12 h-12 mx-auto mb-3 animate-pulse object-contain"/>
        <p className="text-slate-500 text-sm">Loading your rewards...</p>
      </div>
    </div>
  );

  if (err) return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
      <div className="text-center">
        <p className="text-red-500 font-medium mb-3">{err}</p>
        <button onClick={load} className="px-4 py-2 rounded-xl text-white text-sm" style={{ background: '#8b5cf6' }}>Retry</button>
      </div>
    </div>
  );

  const { customer, tiers, visits, referralCount, nextTier, progressToNext } = data;

  // Build tab list based on portalSettings visibility
  const TABS = [
    ps.showMenu && ps.menuImageUrl ? { id: 'menu',    label: 'Menu',    icon: '🍽️' } : null,
    { id: 'rewards',  label: 'Rewards',  icon: '🎁', count: customer.coupons?.length },
    ps.showVisitHistory !== false   ? { id: 'history',  label: 'History',  icon: '📋' } : null,
    ps.showReferral    !== false     ? { id: 'referral', label: 'Refer',    icon: '🎉' } : null,
  ].filter(Boolean) as { id: string; label: string; icon: string; count?: number }[];

  // Default to first tab if current tab is hidden
  const activeTab = TABS.find(t => t.id === tab) ? tab : (TABS[0]?.id ?? 'rewards');

  const visibleCustomSections = (ps.customSections ?? []).filter((s: any) => s.visible);
  const bgImage = ps.bgImageMobile || ps.bgImageDesktop || ps.bgImageTablet || '';

  return (
    <div className="min-h-[100dvh]" style={{ background: bgImage ? `url(${bgImage}) center/cover no-repeat` : '#f8fafc' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(248,250,252,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Loyable" className="w-7 h-7 object-contain"/>
          <span className="font-bold text-slate-800 text-sm">{bizName}</span>
        </div>
        <button onClick={() => { clearSession(); onLogout(); }} className="text-xs text-slate-400 hover:text-slate-600">Sign out</button>
      </div>

      <div className="max-w-sm mx-auto px-4 py-4 space-y-4">
        {/* Announcement */}
        {ps.showAnnouncement && ps.announcementText && (
          <div className="px-4 py-3 rounded-2xl text-sm font-medium" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: 'white' }}>
            📢 {ps.announcementText}
          </div>
        )}

        {/* Geo Check-in */}
        {checkInConfig?.enabled && (
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800 text-sm">📍 Check In</p>
                <p className="text-xs text-slate-500 mt-0.5">Tap to record your visit and earn points</p>
              </div>
              <button onClick={handleCheckIn} disabled={checkingIn}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
                {checkingIn ? '…' : 'Check In'}
              </button>
            </div>
            {checkInMsg && (
              <p className="mt-2 text-xs font-medium rounded-lg px-3 py-2"
                style={{ background: checkInMsg.ok ? '#f0fdf4' : '#fff1f2', color: checkInMsg.ok ? '#16a34a' : '#dc2626' }}>
                {checkInMsg.text}
              </p>
            )}
          </div>
        )}

        {/* Loyalty Card */}
        <LoyaltyCard customer={customer} nextTier={nextTier} progressToNext={progressToNext}/>

        {/* WiFi */}
        {ps.showWifi && (ps.wifiName || ps.wifiPassword) && (
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
            <div className="flex items-center gap-2 mb-2 text-purple-700">
              <Icon.wifi/><span className="font-bold text-sm">Free WiFi</span>
            </div>
            {ps.wifiName && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Network</span>
                <span className="font-mono font-bold text-sm text-slate-800">{ps.wifiName}</span>
              </div>
            )}
            {ps.wifiPassword && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-500">Password</span>
                <span className="font-mono font-bold text-sm text-slate-800">{ps.wifiPassword}</span>
              </div>
            )}
          </div>
        )}

        {/* Custom info sections */}
        {visibleCustomSections.map((section: any, i: number) => (
          <CustomSectionCard key={i} section={section}/>
        ))}

        {/* Tier perks */}
        {tiers.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Your {customer.tier} Perks</p>
            <div className="space-y-1.5">
              {(tiers.find((t: any) => t.name === customer.tier)?.perks ?? []).map((perk: string, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-purple-500"><Icon.check/></span>{perk}
                </div>
              ))}
              {!tiers.find((t: any) => t.name === customer.tier)?.perks?.length && (
                <p className="text-sm text-slate-400">Keep earning points to unlock exclusive perks.</p>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        {TABS.length > 1 && (
          <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'white', border: '1px solid #f1f5f9' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
                style={activeTab === t.id
                  ? { background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: 'white' }
                  : { color: '#64748b' }}
              >
                {t.icon} {t.label}
                {(t as any).count != null && (t as any).count > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-full text-[10px]" style={activeTab === t.id ? { background: 'rgba(255,255,255,0.25)' } : { background: '#ede9fe', color: '#7c3aed' }}>{(t as any).count}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {activeTab === 'menu'    && <MenuTab menuImageUrl={ps.menuImageUrl}/>}
        {activeTab === 'rewards' && <RewardsTab coupons={customer.coupons} onRedeem={handleRedeem} currency={currency}/>}
        {activeTab === 'history' && <VisitsTab visits={visits} currency={currency}/>}
        {activeTab === 'referral'&& <ReferralTab customer={customer} referralCount={referralCount} bizName={bizName}/>}
      </div>
    </div>
  );
}

// ================================================================
// ROOT — handles slug resolution + session persistence
// ================================================================
export default function CustomerPortal() {
  const slug = getSlug();
  const [biz,            setBiz]            = useState<any>(null);
  const [portalSettings, setPortalSettings] = useState<any>({});
  const [token,          setToken]          = useState<string | null>(null);
  const [loaded,         setLoaded]         = useState(false);
  const [checkInConfig,  setCheckInConfig]  = useState<{ enabled: boolean; radiusMeters: number }>({ enabled: false, radiusMeters: 30 });

  useEffect(() => {
    if (!slug) { setLoaded(true); return; }
    const session = loadSession(slug);
    if (session) setToken(session.token);

    portalGet(`/portal/${slug}/info`)
      .then(d => { setBiz(d); setPortalSettings(d.portalSettings ?? {}); if (d.checkIn) setCheckInConfig(d.checkIn); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [slug]);

  if (!loaded) return (
    <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: 'linear-gradient(160deg,#1e0a3c,#3d1a6e)' }}>
      <img src="/logo.svg" alt="" className="w-12 h-12 object-contain animate-pulse"/>
    </div>
  );

  if (!slug || !biz) return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: 'linear-gradient(160deg,#1e0a3c,#3d1a6e)' }}>
      <div className="text-center text-white">
        <img src="/logo.svg" alt="Loyable" className="w-14 h-14 object-contain mx-auto mb-4"/>
        <h1 className="font-black text-xl mb-2">Loyalty Portal</h1>
        {slug
          ? <p className="text-purple-300 text-sm">The loyalty program <span className="font-mono bg-white/10 px-1 rounded">/{slug}</span> was not found or is inactive.</p>
          : <p className="text-purple-300 text-sm">No loyalty program specified in the link.</p>
        }
        <p className="text-purple-400/60 text-xs mt-3">Please ask your business for the correct QR code or link.</p>
      </div>
    </div>
  );

  if (!token) return (
    <LoginScreen
      slug={slug}
      bizName={biz.business?.name ?? slug}
      portalSettings={portalSettings}
      onLogin={(t) => setToken(t)}
    />
  );

  return (
    <Dashboard
      token={token}
      bizName={biz.business?.name ?? slug}
      currency={biz.business?.currency ?? 'GBP'}
      portalSettings={portalSettings}
      checkInConfig={checkInConfig}
      onLogout={() => setToken(null)}
    />
  );
}
