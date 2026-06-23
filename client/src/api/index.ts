// ── Authenticated fetch wrapper ───────────────────────────────────
const BASE = '/api';

async function req<T>(path: string, init: RequestInit = {}, _retryDepth = 0): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && _retryDepth === 0) {
    // Single refresh attempt — depth guard prevents infinite recursion
    try {
      const userId    = localStorage.getItem('userId');
      const sessionId = localStorage.getItem('sessionId');
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, sessionId }),
      });
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem('accessToken', d.accessToken);
        if (d.sessionId) localStorage.setItem('sessionId', d.sessionId);
        return req<T>(path, init, 1); // retry once with new token
      }
    } catch {}
    const hadToken = !!localStorage.getItem('accessToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('sessionId');
    if (hadToken) window.location.href = '/';
    throw new Error('Unauthenticated');
  }

  if (res.status === 401) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('sessionId');
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
    login:         (email: string, password: string) => post<{ accessToken: string; sessionId?: string; user: any }>('/auth/login', { email, password }),
    register:      (body: { businessName: string; ownerName: string; ownerEmail: string; ownerPassword: string; country: string; timezone: string; currency: string; industry?: string }) =>
                     post<{ accessToken: string; user: any }>('/auth/register', body),
    me:            () => get<any>('/auth/me'),
    logout:        () => post('/auth/logout'),
    forgotPassword:(email: string) => post('/auth/forgot-password', { email }),
    resetPassword: (token: string, newPassword: string) => post('/auth/reset-password', { token, newPassword }),
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
    send: (body: { customerId?: string; phone?: string; chatId?: string; message: string }) =>
      post<{ ok: boolean; messageId?: string; chatId?: string }>('/messages/send', body),
    inbox:  () => get<{ conversations: any[] }>(`/messages/inbox?_t=${Date.now()}`),
    thread: (chatId: string, days = 3) =>
      get<{ chatId: string; days: number; messages: any[] }>(`/messages/inbox/${encodeURIComponent(chatId)}?days=${days}&_t=${Date.now()}`),
    broadcast: (body: { message: string; segment?: string; customerIds?: string[] }) =>
      post<{ ok: boolean; sent: number; failed: number; total: number }>('/messages/broadcast', body),
  },

  // ── Campaigns ─────────────────────────────────────────────────
  campaigns: {
    list:   () => get<{ campaigns: any[]; total: number }>('/campaigns'),
    get:    (id: string) => get<any>(`/campaigns/${id}`),
    stats:  (id: string) => get<any>(`/campaigns/${id}/stats`),
    create: (body: any)  => post<any>('/campaigns', body),
    update: (id: string, body: any) => put<any>(`/campaigns/${id}`, body),
    launch: (id: string) => post<any>(`/campaigns/${id}/launch`),
    clone:  (id: string) => post<any>(`/campaigns/${id}/clone`),
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
    qr:           () => get<any>(`/whatsapp/qr?_t=${Date.now()}`),
    startSession: (body?: any) => post<any>('/whatsapp/session/start', body ?? {}),
    stopSession:  () => post<any>('/whatsapp/session/stop', {}),
    saveConfig:   (body: any) => patch<any>('/whatsapp/config', body),
  },

  // ── Website CMS ──────────────────────────────────────────────
  website: {
    public:   ()             => get<any>('/website/public'),
    reviews:  (p?: any)      => get<any>(`/website/reviews?${new URLSearchParams(p??{}).toString()}`),
    partners: ()             => get<any>('/website/partners'),
    blog:     (p?: any)      => get<any>(`/website/blog?${new URLSearchParams(p??{}).toString()}`),
    faq:      ()             => get<any>('/website/faq'),
    submitReview: (b: any)   => post<any>('/website/reviews', b),
    track:    (b: any)       => post<any>('/website/analytics/track', b).catch(()=>({})),
    admin: {
      settings:    ()          => get<any>('/website/admin/settings'),
      putSettings: (b: any)    => put<any>('/website/admin/settings', b),
      sections:    ()          => get<any>('/website/admin/sections'),
      putSection:  (slug: string, v: boolean) => put<any>(`/website/admin/sections/${slug}`, { visible: v }),
      features:    ()          => get<any>('/website/admin/features'),
      addFeature:  (b: any)    => post<any>('/website/admin/features', b),
      putFeature:  (id: string, b: any) => put<any>(`/website/admin/features/${id}`, b),
      delFeature:  (id: string) => del<any>(`/website/admin/features/${id}`),
      pricing:     ()          => get<any>('/website/admin/pricing'),
      addPlan:     (b: any)    => post<any>('/website/admin/pricing', b),
      putPlan:     (id: string, b: any) => put<any>(`/website/admin/pricing/${id}`, b),
      delPlan:     (id: string) => del<any>(`/website/admin/pricing/${id}`),
      testimonials:()          => get<any>('/website/admin/testimonials'),
      addTestimonial:(b: any)  => post<any>('/website/admin/testimonials', b),
      putTestimonial:(id: string, b: any) => put<any>(`/website/admin/testimonials/${id}`, b),
      delTestimonial:(id: string) => del<any>(`/website/admin/testimonials/${id}`),
      partners:    ()          => get<any>('/website/admin/partners'),
      addPartner:  (b: any)    => post<any>('/website/admin/partners', b),
      putPartner:  (id: string, b: any) => put<any>(`/website/admin/partners/${id}`, b),
      delPartner:  (id: string) => del<any>(`/website/admin/partners/${id}`),
      reviews:     (s?: string) => get<any>(`/website/admin/reviews${s?`?status=${s}`:''}`),
      putReview:   (id: string, b: any) => put<any>(`/website/admin/reviews/${id}`, b),
      delReview:   (id: string) => del<any>(`/website/admin/reviews/${id}`),
      blog:        ()          => get<any>('/website/admin/blog'),
      addPost:     (b: any)    => post<any>('/website/admin/blog', b),
      putPost:     (id: string, b: any) => put<any>(`/website/admin/blog/${id}`, b),
      delPost:     (id: string) => del<any>(`/website/admin/blog/${id}`),
      faq:         ()          => get<any>('/website/admin/faq'),
      addFaq:      (b: any)    => post<any>('/website/admin/faq', b),
      putFaq:      (id: string, b: any) => put<any>(`/website/admin/faq/${id}`, b),
      delFaq:      (id: string) => del<any>(`/website/admin/faq/${id}`),
      banners:     ()          => get<any>('/website/admin/banners'),
      addBanner:   (b: any)    => post<any>('/website/admin/banners', b),
      putBanner:   (id: string, b: any) => put<any>(`/website/admin/banners/${id}`, b),
      delBanner:   (id: string) => del<any>(`/website/admin/banners/${id}`),
      analytics:   ()          => get<any>('/website/admin/analytics'),
    },
  },

  // ── Customer Portal (public, uses separate portalToken) ──────
  portal: {
    info:   (slug: string) => get<any>(`/portal/${slug}/info`),
    login:  (slug: string, body: { phone: string; name: string }) =>
              post<{ token: string; customer: { id: string; name: string } }>(`/portal/${slug}/login`, body),
    me: (portalToken: string) =>
      req<any>('/portal/me', { headers: { Authorization: `Bearer ${portalToken}` } }),
    redeem: (portalToken: string, couponCode: string) =>
      req<any>('/portal/redeem', { method: 'POST', body: JSON.stringify({ couponCode }), headers: { Authorization: `Bearer ${portalToken}`, 'Content-Type': 'application/json' } }),
    updateSettings: (slug: string, settings: any) =>
      req<any>(`/portal/${slug}/settings`, { method: 'PATCH', body: JSON.stringify(settings) }),
  },

  // ── File Upload ───────────────────────────────────────────────
  upload: {
    menu: async (file: File): Promise<{ url: string }> => {
      const form = new FormData();
      form.append('file', file);
      const token = localStorage.getItem('accessToken') ?? '';
      const r = await fetch('/api/upload/menu', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Upload failed');
      return r.json();
    },
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
