// ================================================================
//  loyable-admin-panel.tsx
//  Super Admin Panel — Loyable Platform Administration
//
//  Sections:
//   1. Overview        — MRR, KPIs, system health
//   2. Tenants         — List, search, suspend/unsuspend/delete
//   3. Pricing         — Tier price & quota customisation
//   4. Platform        — Global settings (branding, registration, limits)
//   5. Email Config    — SMTP / provider setup + test sender
//   6. Email Templates — Edit & preview all transactional templates
//   7. Announcements   — Broadcast to tier-filtered owners
//   8. Audit Logs      — Platform-wide action history
// ================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────

type Tier = 'FREE' | 'STARTER' | 'GROWTH' | 'PROFESSIONAL' | 'ENTERPRISE';
type EmailProvider = 'SENDGRID' | 'RESEND' | 'NODEMAILER' | 'POSTMARK' | 'DISABLED';

interface TierConfig {
  monthlyPriceGBP:     number;
  annualPriceGBP:      number;
  monthlyMessageQuota: number;
  displayName:         string;
  description:         string;
  isPublic:            boolean;
  features:            string[];
}

interface PlatformSettings {
  platformName:          string;
  platformUrl:           string;
  supportEmail:          string;
  maintenanceMode:       boolean;
  maintenanceBannerText: string;
  allowNewRegistrations: boolean;
  defaultTrial:          { enabled: boolean; days: number };
  globalCooldownHours:   number;
  defaultPointsPerPound: number;
  defaultExpiryDays:     number;
  logoUrl:               string;
  primaryColor:          string;
  accentColor:           string;
}

interface EmailConfig {
  provider:       EmailProvider;
  fromEmail:      string;
  fromName:       string;
  replyTo?:       string;
  apiKey?:        string;
  smtpHost?:      string;
  smtpPort?:      number;
  smtpUser?:      string;
  smtpPass?:      string;
  smtpSecure?:    boolean;
  enableTracking?: boolean;
  unsubscribeUrl?: string;
}

interface EmailTemplate {
  templateId: string;
  subject:    string;
  htmlBody:   string;
  textBody?:  string;
  variables:  string[];
  isActive:   boolean;
}

interface Tenant {
  id:        string;
  name:      string;
  slug:      string;
  isActive:  boolean;
  createdAt: string;
  subscription?: { tier: Tier; status: string; monthlyMessageQuota: number; messagesUsedThisPeriod: number };
  _count?:   { customers: number; users: number; campaigns: number };
}

interface Metrics {
  platform: { totalBusinesses: number; activeBusinesses: number; churnedBusinesses: number; totalCustomers: number; mrr: number; arr: number };
  messaging: { last7Days: number };
  recentSignups: { id: string; name: string; createdAt: string; subscription?: { tier: Tier } }[];
}

// ── API client ────────────────────────────────────────────────────

const BASE = '/api/admin';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('accessToken') ?? '';
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init as any)?.headers ?? {}),
    },
    ...init,
  });
  if (res.status === 401) {
    localStorage.removeItem('accessToken');
    window.location.reload();
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Utilities ─────────────────────────────────────────────────────

const TIER_ORDER: Tier[] = ['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE'];

const TIER_COLORS: Record<Tier, string> = {
  FREE:         'bg-slate-100 text-slate-600',
  STARTER:      'bg-blue-100 text-blue-700',
  GROWTH:       'bg-violet-100 text-violet-700',
  PROFESSIONAL: 'bg-amber-100 text-amber-700',
  ENTERPRISE:   'bg-emerald-100 text-emerald-700',
};

const fmt = {
  gbp:   (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`,
  num:   (n: number) => n.toLocaleString('en-GB'),
  quota: (n: number) => (n === -1 ? '∞' : fmt.num(n)),
  date:  (s: string) => new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
};

// ── Shared UI components ──────────────────────────────────────────

const Badge: React.FC<{ label: string; className?: string }> = ({ label, className = '' }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>{label}</span>
);

const Card: React.FC<{ title?: string; subtitle?: string; children: React.ReactNode; className?: string }> = ({ title, subtitle, children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>
    {(title || subtitle) && (
      <div className="px-6 py-4 border-b border-slate-100">
        {title    && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

const Spinner: React.FC<{ size?: string }> = ({ size = 'h-5 w-5' }) => (
  <svg className={`animate-spin ${size} text-indigo-500`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

const Btn: React.FC<{
  onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'danger' | 'ghost' | 'outline';
  disabled?: boolean; loading?: boolean; children: React.ReactNode; className?: string;
}> = ({ onClick, type = 'button', variant = 'primary', disabled, loading, children, className = '' }) => {
  const base = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const styles: Record<string, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
    danger:  'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    ghost:   'text-slate-600 hover:bg-slate-100 focus:ring-slate-400',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-indigo-400',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={`${base} ${styles[variant]} ${className}`}>
      {loading && <Spinner size="h-4 w-4"/>}
      {children}
    </button>
  );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
  </div>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props} className={`w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${props.className ?? ''}`}/>
);

const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea {...props} className={`w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono ${props.className ?? ''}`}/>
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select {...props} className={`w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white ${props.className ?? ''}`}/>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-3 cursor-pointer">
    <span className="text-sm text-slate-700">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}/>
    </button>
  </label>
);

const Alert: React.FC<{ type: 'success' | 'error' | 'info'; message: string; onClose?: () => void }> = ({ type, message, onClose }) => {
  const styles = { success: 'bg-emerald-50 text-emerald-800 border-emerald-200', error: 'bg-red-50 text-red-800 border-red-200', info: 'bg-blue-50 text-blue-800 border-blue-200' };
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border text-sm ${styles[type]}`}>
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100">✕</button>}
    </div>
  );
};

// ── Section: Overview ─────────────────────────────────────────────

const OverviewSection: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health,  setHealth]  = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<Metrics>('/metrics'),
      apiFetch<any>('/system-health'),
    ]).then(([m, h]) => { setMetrics(m); setHealth(h); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner size="h-8 w-8"/></div>;
  if (error)   return <Alert type="error" message={error}/>;
  if (!metrics || !health) return null;

  const kpis = [
    { label: 'MRR',          value: fmt.gbp(metrics.platform.mrr),              sub: `ARR ${fmt.gbp(metrics.platform.arr)}`, color: 'text-emerald-600' },
    { label: 'Total Tenants',value: fmt.num(metrics.platform.totalBusinesses),   sub: `${fmt.num(metrics.platform.activeBusinesses)} active` },
    { label: 'Customers',    value: fmt.num(metrics.platform.totalCustomers),    sub: 'active profiles' },
    { label: 'Messages 7d',  value: fmt.num(metrics.messaging.last7Days),        sub: 'queued & sent' },
  ];

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.color ?? 'text-slate-800'}`}>{k.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System health */}
        <Card title="System Health" subtitle="Live infrastructure status">
          <div className="space-y-3">
            {[
              { name: 'Database',   ok: health.database?.status === 'connected', sub: `${health.database?.latencyMs ?? '–'}ms` },
              { name: 'Redis',      ok: health.redis?.status    === 'connected', sub: `${health.redis?.latencyMs    ?? '–'}ms` },
              { name: 'API Server', ok: true,                                    sub: `up ${Math.round(health.uptime / 60)}m` },
            ].map(s => (
              <div key={s.name} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${s.ok ? 'bg-emerald-400' : 'bg-red-400'}`}/>
                  <span className="text-sm text-slate-700">{s.name}</span>
                </div>
                <span className="text-xs text-slate-400">{s.sub}</span>
              </div>
            ))}
            <div className="pt-2 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Heap Used',  value: `${health.process?.memoryMB?.heapUsed ?? '–'}MB` },
                { label: 'CPU 1m',     value: health.process?.cpuLoad1m ?? '–' },
                { label: 'Node',       value: health.process?.nodeVersion ?? '–' },
              ].map(m => (
                <div key={m.label} className="bg-slate-50 rounded-lg p-2">
                  <p className="text-xs text-slate-500">{m.label}</p>
                  <p className="text-sm font-semibold text-slate-700 mt-0.5">{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Recent signups */}
        <Card title="Recent Signups" subtitle="Last 30 days">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {metrics.recentSignups.length === 0 ? (
              <p className="text-sm text-slate-400">No recent signups.</p>
            ) : metrics.recentSignups.map(b => (
              <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <span className="text-sm text-slate-700 truncate max-w-[60%]">{b.name}</span>
                <div className="flex items-center gap-2">
                  {b.subscription && <Badge label={b.subscription.tier} className={TIER_COLORS[b.subscription.tier]}/>}
                  <span className="text-xs text-slate-400">{fmt.date(b.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ── Section: Tenants ──────────────────────────────────────────────

const TenantsSection: React.FC = () => {
  const [tenants,  setTenants]  = useState<Tenant[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<{ status: string; tier: string }>({ status: '', tier: '' });
  const [msg,      setMsg]      = useState('');
  const [confirm,  setConfirm]  = useState<{ id: string; action: 'suspend' | 'unsuspend' | 'delete'; name: string } | null>(null);
  const [acting,   setActing]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)        params.set('search', search);
      if (filter.status) params.set('status', filter.status);
      if (filter.tier)   params.set('tier',   filter.tier);
      const data = await apiFetch<Tenant[]>(`/tenants?${params}`);
      setTenants(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [search, filter]);

  useEffect(() => { load(); }, [load]);

  const act = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      if (confirm.action === 'suspend')   await apiFetch(`/tenants/${confirm.id}/suspend`,   { method: 'POST', body: JSON.stringify({ reason: 'Admin action' }) });
      if (confirm.action === 'unsuspend') await apiFetch(`/tenants/${confirm.id}/unsuspend`, { method: 'POST' });
      if (confirm.action === 'delete')    await apiFetch(`/tenants/${confirm.id}`,            { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE_CONFIRMED' }) });
      setMsg(`Tenant ${confirm.name} — ${confirm.action} complete.`);
      setConfirm(null);
      load();
    } catch (e: any) { setMsg(`Error: ${e.message}`); } finally { setActing(false); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs"/>
        <Select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select value={filter.tier} onChange={e => setFilter(f => ({ ...f, tier: e.target.value }))} className="w-44">
          <option value="">All tiers</option>
          {TIER_ORDER.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      {msg && <Alert type={msg.startsWith('Error') ? 'error' : 'success'} message={msg} onClose={() => setMsg('')}/>}
      {error && <Alert type="error" message={error}/>}

      {/* Confirm modal */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-800 mb-2 capitalize">{confirm.action} tenant</h3>
            <p className="text-sm text-slate-600 mb-5">
              {confirm.action === 'delete'
                ? <>Are you sure you want to <strong className="text-red-600">permanently delete</strong> <em>{confirm.name}</em>? This cannot be undone.</>
                : <>Are you sure you want to <strong>{confirm.action}</strong> <em>{confirm.name}</em>?</>}
            </p>
            <div className="flex gap-3 justify-end">
              <Btn variant="ghost" onClick={() => setConfirm(null)}>Cancel</Btn>
              <Btn variant={confirm.action === 'delete' ? 'danger' : 'primary'} onClick={act} loading={acting}>Confirm</Btn>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="h-8 w-8"/></div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                {['Business', 'Tier', 'Status', 'Customers', 'Users', 'Campaigns', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tenants.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">No tenants found.</td></tr>
              ) : tenants.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    {t.subscription ? <Badge label={t.subscription.tier} className={TIER_COLORS[t.subscription.tier]}/> : <span className="text-xs text-slate-400">–</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={t.isActive ? 'Active' : 'Suspended'} className={t.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}/>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt.num(t._count?.customers ?? 0)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt.num(t._count?.users ?? 0)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt.num(t._count?.campaigns ?? 0)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmt.date(t.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Btn variant="ghost" className="text-xs py-1 px-2" onClick={() => setConfirm({ id: t.id, action: t.isActive ? 'suspend' : 'unsuspend', name: t.name })}>
                        {t.isActive ? 'Suspend' : 'Reactivate'}
                      </Btn>
                      <Btn variant="ghost" className="text-xs py-1 px-2 text-red-600 hover:bg-red-50" onClick={() => setConfirm({ id: t.id, action: 'delete', name: t.name })}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Section: Pricing ──────────────────────────────────────────────

const PricingSection: React.FC = () => {
  const [pricing,  setPricing]  = useState<Record<Tier, TierConfig> | null>(null);
  const [selected, setSelected] = useState<Tier>('STARTER');
  const [form,     setForm]     = useState<Partial<TierConfig>>({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ pricing: Record<Tier, TierConfig> }>('/pricing')
      .then(d => { setPricing(d.pricing); setForm(d.pricing[selected]); })
      .catch(e => setMsg({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const selectTier = (t: Tier) => { setSelected(t); if (pricing) setForm(pricing[t]); };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const updated = await apiFetch<{ tier: TierConfig }>('/pricing', {
        method: 'PUT',
        body:   JSON.stringify({ tier: selected, ...form }),
      });
      setPricing(p => p ? { ...p, [selected]: updated.tier } : p);
      setMsg({ type: 'success', text: `${selected} tier saved.` });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setSaving(false); }
  };

  const setF = <K extends keyof TierConfig>(k: K, v: TierConfig[K]) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return <div className="flex justify-center py-16"><Spinner size="h-8 w-8"/></div>;

  return (
    <div className="space-y-6">
      {/* Tier overview table */}
      {pricing && (
        <Card title="Tier Pricing Overview">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Tier', 'Monthly', 'Annual', 'Quota/mo', 'Public', ''].map(h => (
                    <th key={h} className="pb-2 pr-6 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {TIER_ORDER.map(t => {
                  const c = pricing[t];
                  return (
                    <tr key={t} className={`cursor-pointer hover:bg-slate-50 transition-colors ${selected === t ? 'bg-indigo-50/50' : ''}`} onClick={() => selectTier(t)}>
                      <td className="py-2.5 pr-6"><Badge label={c.displayName} className={TIER_COLORS[t]}/></td>
                      <td className="py-2.5 pr-6 font-medium text-slate-700">{fmt.gbp(c.monthlyPriceGBP)}/mo</td>
                      <td className="py-2.5 pr-6 text-slate-500">{fmt.gbp(c.annualPriceGBP)}/yr</td>
                      <td className="py-2.5 pr-6 text-slate-500">{fmt.quota(c.monthlyMessageQuota)}</td>
                      <td className="py-2.5 pr-6">
                        <span className={`text-xs font-medium ${c.isPublic ? 'text-emerald-600' : 'text-slate-400'}`}>{c.isPublic ? 'Yes' : 'Hidden'}</span>
                      </td>
                      <td className="py-2.5">
                        <Btn variant="ghost" className="text-xs py-1 px-2" onClick={e => { e.stopPropagation(); selectTier(t); }}>Edit</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Editor */}
      <Card title={`Edit — ${selected} Tier`} subtitle="Changes sync to Redis immediately; active tenants on this tier are updated.">
        {msg && <div className="mb-4"><Alert type={msg.type} message={msg.text} onClose={() => setMsg(null)}/></div>}

        {/* Tier selector */}
        <div className="flex gap-2 mb-6">
          {TIER_ORDER.map(t => (
            <button key={t} onClick={() => selectTier(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selected === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Display Name">
            <Input value={form.displayName ?? ''} onChange={e => setF('displayName', e.target.value)}/>
          </Field>
          <Field label="Description">
            <Input value={form.description ?? ''} onChange={e => setF('description', e.target.value)}/>
          </Field>
          <Field label="Monthly Price (GBP)" hint="e.g. 29 for £29/month">
            <Input type="number" min={0} value={form.monthlyPriceGBP ?? 0} onChange={e => setF('monthlyPriceGBP', Number(e.target.value))}/>
          </Field>
          <Field label="Annual Price (GBP)" hint="Full year cost, e.g. 278">
            <Input type="number" min={0} value={form.annualPriceGBP ?? 0} onChange={e => setF('annualPriceGBP', Number(e.target.value))}/>
          </Field>
          <Field label="Monthly Message Quota" hint="-1 = unlimited">
            <Input type="number" min={-1} value={form.monthlyMessageQuota ?? 0} onChange={e => setF('monthlyMessageQuota', Number(e.target.value))}/>
          </Field>
          <Field label="Visibility">
            <Toggle checked={form.isPublic ?? true} onChange={v => setF('isPublic', v)} label="Show on public pricing page"/>
          </Field>
          <Field label="Feature Flags" hint="One per line. Use * for all features (Enterprise)." className="md:col-span-2">
            <Textarea
              rows={5}
              value={(form.features ?? []).join('\n')}
              onChange={e => setF('features', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end">
          <Btn onClick={save} loading={saving}>Save Pricing</Btn>
        </div>
      </Card>
    </div>
  );
};

// ── Section: Platform Settings ─────────────────────────────────────

const PlatformSettingsSection: React.FC = () => {
  const [form,    setForm]    = useState<Partial<PlatformSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<PlatformSettings>('/platform-settings')
      .then(d => setForm(d))
      .catch(e => setMsg({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/platform-settings', { method: 'PUT', body: JSON.stringify(form) });
      setMsg({ type: 'success', text: 'Platform settings saved.' });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setSaving(false); }
  };

  const setF = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return <div className="flex justify-center py-16"><Spinner size="h-8 w-8"/></div>;

  return (
    <div className="space-y-6">
      {msg && <Alert type={msg.type} message={msg.text} onClose={() => setMsg(null)}/>}

      <Card title="Branding" subtitle="Platform identity and appearance">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Platform Name">
            <Input value={form.platformName ?? ''} onChange={e => setF('platformName', e.target.value)}/>
          </Field>
          <Field label="Platform URL">
            <Input type="url" value={form.platformUrl ?? ''} onChange={e => setF('platformUrl', e.target.value)}/>
          </Field>
          <Field label="Support Email">
            <Input type="email" value={form.supportEmail ?? ''} onChange={e => setF('supportEmail', e.target.value)}/>
          </Field>
          <Field label="Logo URL">
            <Input type="url" value={form.logoUrl ?? ''} onChange={e => setF('logoUrl', e.target.value)}/>
          </Field>
          <Field label="Primary Colour">
            <div className="flex items-center gap-3">
              <input type="color" value={form.primaryColor ?? '#6366f1'} onChange={e => setF('primaryColor', e.target.value)} className="h-9 w-14 rounded border border-slate-300 cursor-pointer"/>
              <Input value={form.primaryColor ?? ''} onChange={e => setF('primaryColor', e.target.value)} className="flex-1"/>
            </div>
          </Field>
          <Field label="Accent Colour">
            <div className="flex items-center gap-3">
              <input type="color" value={form.accentColor ?? '#8b5cf6'} onChange={e => setF('accentColor', e.target.value)} className="h-9 w-14 rounded border border-slate-300 cursor-pointer"/>
              <Input value={form.accentColor ?? ''} onChange={e => setF('accentColor', e.target.value)} className="flex-1"/>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Access Control" subtitle="Who can sign up and what defaults apply">
        <div className="space-y-4">
          <Toggle checked={form.allowNewRegistrations ?? true} onChange={v => setF('allowNewRegistrations', v)} label="Allow new business registrations"/>
          <Toggle checked={form.maintenanceMode ?? false} onChange={v => setF('maintenanceMode', v)} label="Enable maintenance mode (blocks all tenant logins)"/>
          {form.maintenanceMode && (
            <Field label="Maintenance Banner Message">
              <Input value={form.maintenanceBannerText ?? ''} onChange={e => setF('maintenanceBannerText', e.target.value)} placeholder="We're upgrading our systems. Back in a few minutes."/>
            </Field>
          )}
        </div>
      </Card>

      <Card title="Trial & Defaults" subtitle="Applied to new signups">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Free Trial">
            <Toggle
              checked={form.defaultTrial?.enabled ?? true}
              onChange={v => setF('defaultTrial', { enabled: v, days: form.defaultTrial?.days ?? 14 })}
              label="Enable free trial for new accounts"
            />
          </Field>
          {form.defaultTrial?.enabled && (
            <Field label="Trial Duration (days)">
              <Input type="number" min={1} max={90} value={form.defaultTrial?.days ?? 14}
                onChange={e => setF('defaultTrial', { enabled: true, days: Number(e.target.value) })}/>
            </Field>
          )}
          <Field label="Global Cooldown (hours)" hint="Min gap between messages to the same customer">
            <Input type="number" min={1} max={168} value={form.globalCooldownHours ?? 72} onChange={e => setF('globalCooldownHours', Number(e.target.value))}/>
          </Field>
          <Field label="Default Points per £1 Spent">
            <Input type="number" min={0} max={100} value={form.defaultPointsPerPound ?? 1} onChange={e => setF('defaultPointsPerPound', Number(e.target.value))}/>
          </Field>
          <Field label="Default Points Expiry (days)" hint="0 = never expire">
            <Input type="number" min={0} value={form.defaultExpiryDays ?? 365} onChange={e => setF('defaultExpiryDays', Number(e.target.value))}/>
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Btn onClick={save} loading={saving}>Save Settings</Btn>
      </div>
    </div>
  );
};

// ── Section: Email Config ─────────────────────────────────────────

const EmailConfigSection: React.FC = () => {
  const [form,       setForm]      = useState<Partial<EmailConfig>>({ provider: 'DISABLED', fromEmail: '', fromName: '' });
  const [loading,    setLoading]   = useState(true);
  const [saving,     setSaving]    = useState(false);
  const [testing,    setTesting]   = useState(false);
  const [testTarget, setTestTarget]= useState('');
  const [msg,        setMsg]       = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ configured: boolean; config?: EmailConfig }>('/email-config')
      .then(d => { if (d.config) setForm(d.config); })
      .catch(e => setMsg({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/email-config', { method: 'PUT', body: JSON.stringify(form) });
      setMsg({ type: 'success', text: 'Email configuration saved.' });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!testTarget) return;
    setTesting(true); setMsg(null);
    try {
      await apiFetch('/email-config/test', { method: 'POST', body: JSON.stringify({ to: testTarget }) });
      setMsg({ type: 'success', text: `Test email dispatched to ${testTarget}.` });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setTesting(false); }
  };

  const setF = <K extends keyof EmailConfig>(k: K, v: EmailConfig[K]) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return <div className="flex justify-center py-16"><Spinner size="h-8 w-8"/></div>;

  const provider = form.provider ?? 'DISABLED';

  return (
    <div className="space-y-6">
      {msg && <Alert type={msg.type} message={msg.text} onClose={() => setMsg(null)}/>}

      <Card title="Email Provider" subtitle="Configure the delivery provider for all transactional emails">
        <div className="space-y-5">
          <Field label="Provider">
            <Select value={provider} onChange={e => setF('provider', e.target.value as EmailProvider)}>
              <option value="DISABLED">Disabled (log only)</option>
              <option value="SENDGRID">SendGrid</option>
              <option value="RESEND">Resend</option>
              <option value="POSTMARK">Postmark</option>
              <option value="NODEMAILER">SMTP (Nodemailer)</option>
            </Select>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="From Email">
              <Input type="email" value={form.fromEmail ?? ''} onChange={e => setF('fromEmail', e.target.value)} placeholder="noreply@loyable.io"/>
            </Field>
            <Field label="From Name">
              <Input value={form.fromName ?? ''} onChange={e => setF('fromName', e.target.value)} placeholder="Loyable"/>
            </Field>
            <Field label="Reply-To Email">
              <Input type="email" value={form.replyTo ?? ''} onChange={e => setF('replyTo', e.target.value)} placeholder="support@loyable.io"/>
            </Field>
          </div>

          {/* API key providers */}
          {['SENDGRID', 'RESEND', 'POSTMARK'].includes(provider) && (
            <Field label={`${provider} API Key`}>
              <Input type="password" value={form.apiKey ?? ''} onChange={e => setF('apiKey', e.target.value)} placeholder="sk_live_…"/>
            </Field>
          )}

          {/* SMTP */}
          {provider === 'NODEMAILER' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <Field label="SMTP Host">
                <Input value={form.smtpHost ?? ''} onChange={e => setF('smtpHost', e.target.value)} placeholder="smtp.example.com"/>
              </Field>
              <Field label="SMTP Port">
                <Input type="number" value={form.smtpPort ?? 587} onChange={e => setF('smtpPort', Number(e.target.value))}/>
              </Field>
              <Field label="SMTP User">
                <Input value={form.smtpUser ?? ''} onChange={e => setF('smtpUser', e.target.value)}/>
              </Field>
              <Field label="SMTP Password">
                <Input type="password" value={form.smtpPass ?? ''} onChange={e => setF('smtpPass', e.target.value)}/>
              </Field>
              <div className="md:col-span-2">
                <Toggle checked={form.smtpSecure ?? true} onChange={v => setF('smtpSecure', v)} label="Use TLS (recommended for port 465)"/>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Unsubscribe URL" hint="Appended to marketing emails">
              <Input type="url" value={form.unsubscribeUrl ?? ''} onChange={e => setF('unsubscribeUrl', e.target.value)} placeholder="https://loyable.io/unsubscribe"/>
            </Field>
            <div className="flex flex-col justify-end">
              <Toggle checked={form.enableTracking ?? false} onChange={v => setF('enableTracking', v)} label="Enable open & click tracking"/>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Btn onClick={save} loading={saving}>Save Configuration</Btn>
        </div>
      </Card>

      {/* Test email */}
      <Card title="Test Email" subtitle="Send a test email to verify the provider is working">
        <div className="flex gap-3">
          <Input type="email" value={testTarget} onChange={e => setTestTarget(e.target.value)} placeholder="you@example.com" className="max-w-sm"/>
          <Btn onClick={sendTest} loading={testing} disabled={!testTarget} variant="outline">Send Test</Btn>
        </div>
      </Card>
    </div>
  );
};

// ── Section: Email Templates ──────────────────────────────────────

const TEMPLATE_IDS = ['PASSWORD_RESET','STAFF_INVITE','QUOTA_WARNING','QUOTA_EXHAUSTED','PAYMENT_FAILED','PLATFORM_ANNOUNCEMENT','WELCOME','TIER_UPGRADE_NOTICE','SUSPENSION_NOTICE'];

const EmailTemplatesSection: React.FC = () => {
  const [templates, setTemplates] = useState<Record<string, EmailTemplate>>({});
  const [selected,  setSelected]  = useState(TEMPLATE_IDS[0]);
  const [form,      setForm]      = useState<Partial<EmailTemplate>>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [resetting, setResetting] = useState(false);
  const [preview,   setPreview]   = useState<{ subject: string; htmlBody: string } | null>(null);
  const [previewing,setPreviewing]= useState(false);
  const [msg,       setMsg]       = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tab,       setTab]       = useState<'html' | 'text' | 'preview'>('html');

  const load = () => {
    setLoading(true);
    apiFetch<{ templates: Record<string, EmailTemplate> }>('/email-templates')
      .then(d => { setTemplates(d.templates); const t = d.templates[selected]; if (t) setForm(t); })
      .catch(e => setMsg({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const selectTemplate = (id: string) => {
    setSelected(id);
    setForm(templates[id] ?? {});
    setPreview(null);
    setTab('html');
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/email-templates', { method: 'PUT', body: JSON.stringify({ templateId: selected, ...form }) });
      setTemplates(t => ({ ...t, [selected]: { ...t[selected], ...form } as EmailTemplate }));
      setMsg({ type: 'success', text: 'Template saved.' });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm(`Reset ${selected} to the built-in default?`)) return;
    setResetting(true); setMsg(null);
    try {
      const d = await apiFetch<{ template: EmailTemplate }>(`/email-templates/reset/${selected}`, { method: 'POST' });
      setTemplates(t => ({ ...t, [selected]: d.template }));
      setForm(d.template);
      setMsg({ type: 'success', text: `${selected} reset to default.` });
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setResetting(false); }
  };

  const buildPreview = async () => {
    setPreviewing(true);
    try {
      const sampleVars: Record<string, string> = {
        name: 'Jane Smith', businessName: 'The Coffee House', resetUrl: '#', expiryMinutes: '30',
        expiryHours: '48', acceptUrl: '#', role: 'MANAGER', upgradeUrl: '#', billingUrl: '#',
        amountDue: '79.00', percentUsed: '90', used: '9000', total: '10000', subject: 'Platform Update',
        body: 'This is a sample announcement body.', dashboardUrl: '#', oldTier: 'GROWTH',
        newTier: 'PROFESSIONAL', newQuota: '50,000', reason: 'Payment failure', supportEmail: 'support@loyable.io',
      };
      const p = await apiFetch<{ subject: string; htmlBody: string }>('/email-templates/preview', {
        method: 'POST',
        body: JSON.stringify({ templateId: selected, variables: sampleVars }),
      });
      setPreview(p);
      setTab('preview');
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setPreviewing(false); }
  };

  const setF = <K extends keyof EmailTemplate>(k: K, v: EmailTemplate[K]) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return <div className="flex justify-center py-16"><Spinner size="h-8 w-8"/></div>;

  return (
    <div className="flex gap-6 h-full">
      {/* Template list sidebar */}
      <div className="w-56 shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">Templates</div>
          <ul className="divide-y divide-slate-50">
            {TEMPLATE_IDS.map(id => {
              const tpl = templates[id];
              return (
                <li key={id}>
                  <button
                    onClick={() => selectTemplate(id)}
                    className={`w-full text-left px-4 py-3 text-xs transition-colors ${selected === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <span className="block truncate">{id.replace(/_/g, ' ')}</span>
                    {tpl && <span className={`mt-0.5 block ${tpl.isActive ? 'text-emerald-500' : 'text-slate-400'}`}>{tpl.isActive ? '● Active' : '○ Disabled'}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 space-y-4 min-w-0">
        {msg && <Alert type={msg.type} message={msg.text} onClose={() => setMsg(null)}/>}

        <Card title={selected.replace(/_/g, ' ')} subtitle="Edit subject line and HTML/text body">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Toggle checked={form.isActive ?? true} onChange={v => setF('isActive', v)} label="Template active"/>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={buildPreview} loading={previewing} className="text-xs">Preview</Btn>
                <Btn variant="ghost" onClick={reset} loading={resetting} className="text-xs text-red-600 hover:bg-red-50">Reset to default</Btn>
              </div>
            </div>

            <Field label="Subject Line" hint={`Variables: ${(form.variables ?? []).map(v => `{{${v}}}`).join(', ')}`}>
              <Input value={form.subject ?? ''} onChange={e => setF('subject', e.target.value)}/>
            </Field>

            {/* Tab bar */}
            <div className="border-b border-slate-200">
              {(['html', 'text', 'preview'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`mr-4 pb-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  {t === 'html' ? 'HTML Body' : t === 'text' ? 'Plain Text' : 'Preview'}
                </button>
              ))}
            </div>

            {tab === 'html' && (
              <Textarea rows={16} value={form.htmlBody ?? ''} onChange={e => setF('htmlBody', e.target.value)} placeholder="<div>Email HTML…</div>"/>
            )}
            {tab === 'text' && (
              <Textarea rows={10} value={form.textBody ?? ''} onChange={e => setF('textBody', e.target.value)} placeholder="Plain text version…"/>
            )}
            {tab === 'preview' && preview && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <strong>Subject:</strong> {preview.subject}
                </div>
                <iframe srcDoc={preview.htmlBody} title="email-preview" className="w-full" style={{ height: '400px', border: 'none' }}/>
              </div>
            )}
            {tab === 'preview' && !preview && (
              <div className="text-sm text-slate-400 py-8 text-center">Click "Preview" to render the template with sample data.</div>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <Btn onClick={save} loading={saving}>Save Template</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ── Section: Announcements ────────────────────────────────────────

const AnnouncementsSection: React.FC = () => {
  const [form,    setForm]    = useState({ subject: '', body: '', tier: 'ALL' });
  const [sending, setSending] = useState(false);
  const [msg,     setMsg]     = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const send = async () => {
    setSending(true); setMsg(null);
    try {
      const r = await apiFetch<{ message: string; sent: number; total: number }>('/announce', { method: 'POST', body: JSON.stringify(form) });
      setMsg({ type: 'success', text: r.message });
      setForm(f => ({ ...f, subject: '', body: '' }));
    } catch (e: any) { setMsg({ type: 'error', text: e.message }); } finally { setSending(false); }
  };

  return (
    <Card title="Platform Announcement" subtitle="Broadcast an email to all tenant owners (or a specific tier)">
      {msg && <div className="mb-4"><Alert type={msg.type} message={msg.text} onClose={() => setMsg(null)}/></div>}
      <div className="space-y-4 max-w-2xl">
        <Field label="Recipient Tier">
          <Select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}>
            <option value="ALL">All tiers</option>
            {TIER_ORDER.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Subject">
          <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Important update from Loyable"/>
        </Field>
        <Field label="Message Body">
          <Textarea rows={8} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Write your announcement here…"/>
        </Field>
        <div className="flex justify-end">
          <Btn onClick={send} loading={sending} disabled={!form.subject || !form.body}>
            Send Announcement
          </Btn>
        </div>
      </div>
    </Card>
  );
};

// ── Section: Audit Logs ───────────────────────────────────────────

const AuditLogsSection: React.FC = () => {
  const [logs,    setLogs]    = useState<any[]>([]);
  const [filter,  setFilter]  = useState({ businessId: '', action: '', limit: '100' });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filter.businessId) p.set('businessId', filter.businessId);
      if (filter.action)     p.set('action', filter.action);
      p.set('limit', filter.limit);
      setLogs(await apiFetch(`/audit-logs?${p}`));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Business ID…"   value={filter.businessId} onChange={e => setFilter(f => ({ ...f, businessId: e.target.value }))} className="max-w-xs"/>
        <Input placeholder="Action filter…" value={filter.action}     onChange={e => setFilter(f => ({ ...f, action:     e.target.value }))} className="max-w-xs"/>
        <Select value={filter.limit} onChange={e => setFilter(f => ({ ...f, limit: e.target.value }))} className="w-32">
          {['50','100','250','500'].map(v => <option key={v} value={v}>{v} rows</option>)}
        </Select>
      </div>

      {error && <Alert type="error" message={error}/>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="h-8 w-8"/></div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                {['Timestamp', 'Action', 'Business', 'User', 'Role'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {logs.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400">No logs found.</td></tr>
              ) : logs.map((log, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{fmt.date(log.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-indigo-700">{log.action}</td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs truncate max-w-[180px]">{log.businessId}</td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs">{log.user?.email ?? log.userId ?? '–'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{log.user?.role ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Root: LoyableAdminPanel ───────────────────────────────────────

type Section = 'overview' | 'tenants' | 'pricing' | 'settings' | 'email-config' | 'email-templates' | 'announcements' | 'audit-logs';

interface NavItem { id: Section; label: string; icon: string }

const NAV: NavItem[] = [
  { id: 'overview',        label: 'Overview',        icon: '◈' },
  { id: 'tenants',         label: 'Tenants',         icon: '⊞' },
  { id: 'pricing',         label: 'Pricing',         icon: '£' },
  { id: 'settings',        label: 'Platform',        icon: '⚙' },
  { id: 'email-config',    label: 'Email Config',    icon: '◉' },
  { id: 'email-templates', label: 'Email Templates', icon: '✉' },
  { id: 'announcements',   label: 'Announce',        icon: '⊠' },
  { id: 'audit-logs',      label: 'Audit Logs',      icon: '≡' },
];

export const LoyableAdminPanel: React.FC = () => {
  const [section, setSection] = useState<Section>('overview');

  const content: Record<Section, React.ReactNode> = {
    'overview':        <OverviewSection/>,
    'tenants':         <TenantsSection/>,
    'pricing':         <PricingSection/>,
    'settings':        <PlatformSettingsSection/>,
    'email-config':    <EmailConfigSection/>,
    'email-templates': <EmailTemplatesSection/>,
    'announcements':   <AnnouncementsSection/>,
    'audit-logs':      <AuditLogsSection/>,
  };

  const current = NAV.find(n => n.id === section)!;

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">L</div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">Loyable</p>
              <p className="text-xs text-slate-400">Platform Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${section === item.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
          Loyable Platform v1.0
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base font-semibold text-slate-800">{current.label}</h1>
            <p className="text-xs text-slate-400">Platform Administrator</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400"/>
            <span className="text-xs text-slate-500">All systems operational</span>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">
          {content[section]}
        </div>
      </main>
    </div>
  );
};

export default LoyableAdminPanel;
