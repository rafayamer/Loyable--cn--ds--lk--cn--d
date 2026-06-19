// ── Authenticated fetch wrapper ───────────────────────────────────
const BASE = '/api';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401) {
    // Try refresh
    try {
      const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem('accessToken', d.accessToken);
        return req<T>(path, init);
      }
    } catch {}
    localStorage.removeItem('accessToken');
    window.location.href = '/';
    throw new Error('Unauthenticated');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

const get  = <T>(path: string) => req<T>(path);
const post = <T>(path: string, body?: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put   = <T>(path: string, body?: unknown) => req<T>(path, { method: 'PUT',   body: JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) => req<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del  = <T>(path: string, body?: unknown) => req<T>(path, { method: 'DELETE', body: JSON.stringify(body) });

// ── Auth ──────────────────────────────────────────────────────────
export const api = {
  auth: {
    login:  (email: string, password: string) => post<{ accessToken: string; user: any }>('/auth/login', { email, password }),
    me:     () => get<any>('/auth/me'),
    logout: () => post('/auth/logout'),
  },

  // ── Dashboard ─────────────────────────────────────────────────
  dashboard: {
    get: () => get<{
      kpis: {
        totalCustomers: number; activeCustomers: number; newThisMonth: number;
        revenue: number; revenuePrevMonth: number; revenueChange: number;
        visits: number; messagesThisMonth: number; quotaUsed: number; quotaTotal: number;
      };
      visitTrend: { day: string; visits: number; revenue: number }[];
      segments:   { name: string; value: number }[];
    }>('/loyalty/dashboard'),
  },

  // ── Customers ─────────────────────────────────────────────────
  customers: {
    list: (params?: { q?: string; segment?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams(params as any).toString();
      return get<{ customers: any[]; total: number; page: number; pages: number }>(`/loyalty/customers?${qs}`);
    },
    profile:  (id: string)  => get<any>(`/loyalty/${id}/profile`),
    referrals:(id: string)  => get<any>(`/loyalty/${id}/referrals`),
    checkin:  (body: any)   => post<any>('/loyalty/checkin', body),
    redeem:   (id: string, body: any) => post<any>(`/loyalty/${id}/redeem`, body),
  },

  // ── Analytics ─────────────────────────────────────────────────
  analytics: {
    snapshot: (days?: number) => get<any[]>(`/loyalty/analytics/snapshot?days=${days ?? 30}`),
    tiers:    () => get<any[]>('/loyalty/tiers'),
    updateTiers: (tiers: any[]) => put<any>('/loyalty/tiers', tiers),
  },

  // ── Messages ──────────────────────────────────────────────────
  messages: {
    list: (params?: { status?: string; page?: number; limit?: number; search?: string }) => {
      const qs = new URLSearchParams(params as any).toString();
      return get<{ messages: any[]; total: number; page: number }>(`/messages?${qs}`);
    },
    send: (body: { customerId?: string; phone?: string; message: string }) =>
      post<{ ok: boolean; messageId?: string }>('/messages/send', body),
  },

  // ── Campaigns ─────────────────────────────────────────────────
  campaigns: {
    list:   () => get<{ campaigns: any[]; total: number }>('/campaigns'),
    get:    (id: string) => get<any>(`/campaigns/${id}`),
    stats:  (id: string) => get<any>(`/campaigns/${id}/stats`),
    create: (body: any)  => post<any>('/campaigns', body),
    update: (id: string, body: any) => put<any>(`/campaigns/${id}`, body),
    launch: (id: string) => post<any>(`/campaigns/${id}/launch`),
    pause:  (id: string) => post<any>(`/campaigns/${id}/pause`),
    schedule:(id: string, body: any) => post<any>(`/campaigns/${id}/schedule`, body),
  },

  // ── Automations ───────────────────────────────────────────────
  automations: {
    list:     () => get<{ workflows: any[] }>('/automations'),
    get:      (id: string) => get<any>(`/automations/${id}`),
    create:   (body: any)  => post<any>('/automations', body),
    update:   (id: string, body: any) => put<any>(`/automations/${id}`, body),
    activate: (id: string) => post<any>(`/automations/${id}/activate`),
    deactivate:(id:string) => post<any>(`/automations/${id}/deactivate`),
    delete:   (id: string) => del<any>(`/automations/${id}`),
  },

  // ── AI ────────────────────────────────────────────────────────
  ai: {
    query: (question: string) => post<{ answer: string; data?: any; chart?: any }>('/ai/query', { question }),
  },

  // ── Settings (business) ───────────────────────────────────────
  settings: {
    get:    () => get<any>('/auth/me'),
    update: (body: any) => put<any>('/auth/me', body),
  },

  // ── WhatsApp / WAHA ───────────────────────────────────────────
  whatsapp: {
    status:       () => get<any>('/whatsapp/status'),
    qr:           () => get<any>('/whatsapp/qr'),
    startSession: (body?: any) => post<any>('/whatsapp/session/start', body ?? {}),
    stopSession:  () => post<any>('/whatsapp/session/stop', {}),
    saveConfig:   (body: any) => patch<any>('/whatsapp/config', body),
    saveMeta:     (body: any) => patch<any>('/whatsapp/meta', body),
  },

  // ── POS & FBR ─────────────────────────────────────────────────
  pos: {
    stats:      () => get<any>('/pos/stats'),
    sales:      (params?: any) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return get<any>(`/pos/sales${qs}`);
    },
    sale:       (id: string)   => get<any>(`/pos/sale/${id}`),
    createSale: (body: any)    => post<any>('/pos/sale', body),
    retryFbr:   (id: string)   => post<any>(`/pos/sale/${id}/fbr-retry`, {}),
    receipt:    (id: string)   => `/api/pos/receipt/${id}`,
  },
};
