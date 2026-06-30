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
    // Redirect to /login (the CRM auth), NOT '/' — '/' is now the marketing
    // website, so sending a signed-out user there looked like "login bounced
    // me back to the homepage".
    if (hadToken) window.location.href = '/login';
    throw new Error('Unauthenticated');
  }

  if (res.status === 401) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('sessionId');
    window.location.href = '/login';
    throw new Error('Unauthenticated');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface field-level validation detail when present so the user sees
    // the real problem ("Must contain a number") instead of "VALIDATION_ERROR".
    if (Array.isArray(data?.fields) && data.fields.length) {
      throw new Error(data.fields.map((f: any) => `${f.path}: ${f.message}`).join('; '));
    }
    throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
  }
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
    login:         (email: string, password: string, businessId?: string, totpCode?: string) => post<{ accessToken: string; sessionId?: string; user: any; requiresBusinessSelection?: boolean; businesses?: any[] }>('/auth/login', { email, password, ...(businessId ? { businessId } : {}), ...(totpCode ? { totpCode } : {}) }),
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

    // Executive dashboard: KPIs + operational widgets + today's tasks
    overview: (days?: number) => get<{
      windowDays: number;
      generatedAt: string;
      kpis: Record<string, { value: number; deltaPct: number | null; trend: 'up' | 'down' | 'flat' }>;
      widgets: Record<string, any>;
      tasks: Array<{
        id: string; type: string; priority: 'HIGH' | 'MEDIUM' | 'LOW';
        title: string; detail: string; actionPath: string; actionLabel: string;
        customerId?: string; refId?: string;
      }>;
    }>(`/dashboard/overview?days=${days ?? 30}`),

    // AI Business Advisor: rules-engine insights + optional LLM summary
    advisor: () => get<{
      generatedAt: string;
      summary: string | null;
      insights: Array<{
        id: string; category: string; severity: 'opportunity' | 'warning' | 'critical' | 'positive';
        title: string; body: string; metric?: string; actionLabel: string; actionPath: string;
      }>;
    }>('/dashboard/advisor'),
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
    create:   (body: any)   => post<any>('/loyalty/customers', body),
    update:   (id: string, body: any) => patch<any>(`/loyalty/customers/${id}`, body),
    remove:   (id: string)  => del<any>(`/loyalty/customers/${id}`),
    setStaff: (id: string, isStaff: boolean) => patch<any>(`/loyalty/customers/${id}`, { isStaff }),
    purge:    (phone: string) => post<any>('/loyalty/customers/purge', { phone }),

    // ── Customers Module (rich CRM) ─────────────────────────────
    search:   (params?: { q?: string; segment?: string; tag?: string; consent?: string; sort?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v != null && v !== '') as any).toString();
      return get<{ customers: any[]; total: number; page: number; pages: number }>(`/customers?${qs}`);
    },
    full:       (id: string) => get<any>(`/customers/${id}`),
    timeline:   (id: string) => get<{ events: any[] }>(`/customers/${id}/timeline`),
    financials: (id: string) => get<any>(`/customers/${id}/financials`),
    referrals2: (id: string) => get<any>(`/customers/${id}/referrals`),
    reviews:    (id: string) => get<{ reviews: any[]; count: number; avgScore: number | null }>(`/customers/${id}/reviews`),
    setTags:    (id: string, tags: string[]) => patch<{ tags: string[] }>(`/customers/${id}/tags`, { tags }),
    setEnrichment: (id: string, body: { preferences?: Record<string, any>; favouriteProducts?: string[]; social?: Record<string, string> }) => patch<any>(`/customers/${id}/enrichment`, body),
    addNote:    (id: string, body: string, pinned?: boolean) => post<any>(`/customers/${id}/notes`, { body, pinned }),
    deleteNote: (id: string, noteId: string) => del<any>(`/customers/${id}/notes/${noteId}`),
    adjustPoints: (id: string, points: number, direction: 'CREDIT'|'DEBIT', reason?: string) => post<any>(`/customers/${id}/points`, { points, direction, reason }),
    segments:   () => get<{ total: number; segments: { segment: string; count: number; percentage: number; revenue: number }[] }>('/customers/segments'),
    savedViews: () => get<{ views: any[] }>('/customers/saved-views'),
    createSavedView: (name: string, filtersJson: Record<string, any>, isShared?: boolean) => post<any>('/customers/saved-views', { name, filtersJson, isShared }),
    deleteSavedView: (id: string) => del<any>(`/customers/saved-views/${id}`),
    exportCsv:  async (params?: Record<string, any>) => {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v != null && v !== '') as any).toString();
      const res = await fetch(`/api/customers/export?${qs}`, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    },
  },

  account: {
    deleteAll: (confirmName: string) => del<any>('/auth/account', { confirmName }),
  },

  staff: {
    list:   () => get<{ staff: any[] }>('/auth/staff'),
    create: (body: { name: string; role: string; password: string; personalEmail: string }) =>
              post<{ loginEmail: string; name: string; role: string }>('/auth/staff', body),
    remove: (userId: string) => del<any>(`/auth/staff/${userId}`),
  },

  // ── Loyalty Engine (rewards · gift cards · gamification · QR) ──
  loyaltyEngine: {
    rewards:        (activeOnly?: boolean) => get<{ rewards: any[] }>(`/loyalty-engine/rewards${activeOnly ? '?activeOnly=true' : ''}`),
    createReward:   (body: any) => post<any>('/loyalty-engine/rewards', body),
    updateReward:   (id: string, body: any) => patch<any>(`/loyalty-engine/rewards/${id}`, body),
    deleteReward:   (id: string) => del<any>(`/loyalty-engine/rewards/${id}`),
    redeemReward:   (id: string, customerId?: string) => post<any>(`/loyalty-engine/rewards/${id}/redeem${customerId ? `?customerId=${customerId}` : ''}`, {}),
    redemptions:    (status?: string) => get<{ redemptions: any[] }>(`/loyalty-engine/rewards/redemptions${status ? `?status=${status}` : ''}`),
    fulfill:        (id: string) => post<any>(`/loyalty-engine/rewards/redemptions/${id}/fulfill`, {}),

    giftCards:      () => get<{ cards: any[]; outstandingBalance: number; activeCount: number }>('/loyalty-engine/gift-cards'),
    issueGiftCard:  (body: any) => post<any>('/loyalty-engine/gift-cards', body),
    lookupGiftCard: (code: string) => get<any>(`/loyalty-engine/gift-cards/${encodeURIComponent(code)}`),
    redeemGiftCard: (code: string, customerId: string) => post<any>('/loyalty-engine/gift-cards/redeem', { code, customerId }),
    deleteGiftCard: (id: string) => del<any>(`/loyalty-engine/gift-cards/${id}`),
    requestGiftCardDeletion: (id: string, reason?: string) => post<any>(`/loyalty-engine/gift-cards/${id}/request-deletion`, { reason }),

    challenges:     (customerId?: string) => get<{ challenges: any[] }>(`/loyalty-engine/challenges${customerId ? `?customerId=${customerId}` : ''}`),
    createChallenge:(body: any) => post<any>('/loyalty-engine/challenges', body),
    updateChallenge:(id: string, body: any) => patch<any>(`/loyalty-engine/challenges/${id}`, body),
    deleteChallenge:(id: string) => del<any>(`/loyalty-engine/challenges/${id}`),
    badges:         (customerId: string) => get<{ badges: any[] }>(`/loyalty-engine/badges?customerId=${customerId}`),

    generateQr:     (body: any) => post<{ token: string; exp: number | null; checkinUrl: string }>('/loyalty-engine/qr/generate', body),
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

  // ── Billing / quota ───────────────────────────────────────────
  billing: {
    get: () => get<{
      subscription: { monthlyMessageQuota?: number; messagesUsedThisPeriod?: number; tier?: string } | null;
      quotaRemaining: number | null;
      tierLimits: { quota: number } | null;
    }>('/billing'),
    checkout:     (plan: string) => post<{ url: string; metadataAttached: boolean }>('/billing/checkout', { plan }),
    subscription: () => get<any>('/billing/subscription'),
    simulate:     (plan: string, code: string) => post<any>('/billing/simulate', { plan, code }),
  },

  // ── Campaigns ─────────────────────────────────────────────────
  campaigns: {
    list:   () => get<{ campaigns: any[]; total: number }>('/campaigns'),
    get:    (id: string) => get<any>(`/campaigns/${id}`),
    stats:  (id: string) => get<any>(`/campaigns/${id}/stats`),
    create: (body: any)  => post<any>('/campaigns', body),
    update: (id: string, body: any) => put<any>(`/campaigns/${id}`, body),
    launch: (id: string) => post<any>(`/campaigns/${id}/launch`),
    clone:   (id: string) => post<any>(`/campaigns/${id}/clone`),
    abStats: (id: string) => get<any>(`/campaigns/${id}/ab-stats`),
    pause:   (id: string) => post<any>(`/campaigns/${id}/pause`),
    schedule: (id: string, body: any) => post<any>(`/campaigns/${id}/schedule`, body),
    approve:  (id: string) => post<any>(`/campaigns/${id}/approve`),
    reject:   (id: string, reason?: string) => post<any>(`/campaigns/${id}/reject`, { reason }),
  },

  // ── Automations ───────────────────────────────────────────────
  automations: {
    list:     () => get<{ workflows: any[] }>('/automations'),
    get:      (id: string) => get<any>(`/automations/${id}`),
    create:   (body: any)  => post<any>('/automations', body),
    update:   (id: string, body: any) => put<any>(`/automations/${id}`, body),
    activate: (id: string) => post<any>(`/automations/${id}/activate`),
    deactivate:(id:string) => post<any>(`/automations/${id}/pause`),
    delete:   (id: string) => del<any>(`/automations/${id}`),
    runs:          (id: string, params?: { limit?: number; page?: number }) => {
      const qs = params ? '?' + new URLSearchParams(params as any).toString() : '';
      return get<{ runs: any[]; total: number }>(`/automations/${id}/runs${qs}`);
    },
    testFire: (id: string, customerId: string) => post<any>(`/automations/${id}/trigger/${customerId}`),
  },

  // ── Integrations ─────────────────────────────────────────────
  integrations: {
    list:    ()                                    => get<any[]>('/integrations'),
    get:     (provider: string)                    => get<any>(`/integrations/${provider}`),
    update:  (provider: string, body: any)         => put<any>(`/integrations/${provider}`, body),
    remove:  (provider: string)                    => del<any>(`/integrations/${provider}`),
    test:    (provider: string)                    => post<any>(`/integrations/${provider}/test`),
  },

  // ── Custom Segments ───────────────────────────────────────────
  segments: {
    list:     ()                          => get<any[]>('/segments'),
    create:   (body: any)                 => post<any>('/segments', body),
    update:   (id: string, body: any)     => put<any>(`/segments/${id}`, body),
    delete:   (id: string)                => del<any>(`/segments/${id}`),
    evaluate: (rules: any)                => post<any>('/segments/evaluate', { rules }),
    evaluateById: (id: string)            => post<any>(`/segments/${id}/evaluate`),
  },

  // ── Operations · HR & Staff ───────────────────────────────────
  hr: {
    summary:        ()                       => get<any>('/hr/summary'),
    // Employees
    employees:      (p?: any)                => get<any>(`/hr/employees${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    employee:       (id: string)             => get<any>(`/hr/employees/${id}`),
    createEmployee: (b: any)                 => post<any>('/hr/employees', b),
    updateEmployee: (id: string, b: any)     => put<any>(`/hr/employees/${id}`, b),
    deleteEmployee: (id: string)             => del<any>(`/hr/employees/${id}`),
    setOnboarding:  (id: string, key: string, done: boolean) => patch<any>(`/hr/employees/${id}/onboarding`, { key, done }),
    addDocument:    (id: string, b: any)     => post<any>(`/hr/employees/${id}/documents`, b),
    uploadDocument: async (id: string, file: File, meta: { name?: string; type?: string }): Promise<any> => {
      const form = new FormData();
      form.append('file', file);
      if (meta.name) form.append('name', meta.name);
      if (meta.type) form.append('type', meta.type);
      const token = localStorage.getItem('accessToken') ?? '';
      const r = await fetch(`/api/hr/employees/${id}/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? d?.error ?? 'Upload failed');
      return d;
    },
    deleteDocument: (docId: string)          => del<any>(`/hr/documents/${docId}`),
    invite:         (id: string)             => post<any>(`/hr/employees/${id}/invite`, {}),
    setStatus:      (id: string, status: string) => post<any>(`/hr/employees/${id}/status`, { status }),
    // Roles & permissions
    roles:          ()                       => get<any>('/hr/roles'),
    createRole:     (b: any)                 => post<any>('/hr/roles', b),
    updateRole:     (id: string, b: any)     => put<any>(`/hr/roles/${id}`, b),
    deleteRole:     (id: string)             => del<any>(`/hr/roles/${id}`),
    // Training
    training:       ()                       => get<any>('/hr/training'),
    createTraining: (b: any)                 => post<any>('/hr/training', b),
    updateTraining: (id: string, b: any)     => put<any>(`/hr/training/${id}`, b),
    deleteTraining: (id: string)             => del<any>(`/hr/training/${id}`),
    setProgress:    (moduleId: string, b: any) => post<any>(`/hr/training/${moduleId}/progress`, b),
    // Attendance
    attendance:     (p?: any)                => get<any>(`/hr/attendance${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    clockIn:        (b: any)                 => post<any>('/hr/attendance/clock-in', b),
    clockOut:       (id: string, b?: any)    => post<any>(`/hr/attendance/${id}/clock-out`, b ?? {}),
    // Shifts
    shifts:         (p?: any)                => get<any>(`/hr/shifts${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    createShift:    (b: any)                 => post<any>('/hr/shifts', b),
    updateShift:    (id: string, b: any)     => put<any>(`/hr/shifts/${id}`, b),
    deleteShift:    (id: string)             => del<any>(`/hr/shifts/${id}`),
    // Leave
    leave:          (p?: any)                => get<any>(`/hr/leave${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    createLeave:    (b: any)                 => post<any>('/hr/leave', b),
    decideLeave:    (id: string, decision: string) => post<any>(`/hr/leave/${id}/decision`, { decision }),
    deleteLeave:    (id: string)             => del<any>(`/hr/leave/${id}`),
    // Performance
    performance:    (p?: any)                => get<any>(`/hr/performance${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    // Rewards
    rewards:        (p?: any)                => get<any>(`/hr/rewards${p ? `?${new URLSearchParams(p).toString()}` : ''}`),
    createReward:   (b: any)                 => post<any>('/hr/rewards', b),
    decideReward:   (id: string, decision: string) => post<any>(`/hr/rewards/${id}/decision`, { decision }),
  },

  // ── Plans & entitlements ──────────────────────────────────────
  entitlements: {
    get:        () => get<any>('/entitlements'),
    publicPlans:() => get<any>('/plans'),
    redeem:     (code: string) => post<any>('/entitlements/redeem', { code }),
  },

  // ── AI Business Advisor + Reports ─────────────────────────────
  aiAdvisor: {
    ask:            (question: string)        => post<any>('/ai-advisor/ask', { question }),
    reports:        ()                        => get<any>('/ai-advisor/reports'),
    previewReport:  (type: 'WEEKLY'|'MONTHLY')=> post<any>('/ai-advisor/reports/preview', { type }),
    generateReport: (type: 'WEEKLY'|'MONTHLY', email?: boolean) => post<any>('/ai-advisor/reports/generate', { type, email: !!email }),
  },

  // ── AI ────────────────────────────────────────────────────────
  ai: {
    query:            (question: string) => post<{ answer: string; data?: any; chart?: any }>('/ai/query', { question }),
    generateMessage:  (prompt: string, bizName?: string) => post<{ message: string }>('/ai/generate-message', { prompt, bizName }),
    cohortRetention:  (months?: number) => get<any>(`/ai/cohort-retention${months ? `?months=${months}` : ''}`),
    npsStats:         (days?: number)   => get<any>(`/ai/nps-stats${days ? `?days=${days}` : ''}`),
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
    // Step 1: request an OTP (sent over WhatsApp). Returns { otpRequired, phone, devCode? }.
    login:  (slug: string, body: { phone: string; name: string; ref?: string; email?: string; consentMarketing?: boolean }) =>
              post<{ otpRequired: boolean; phone: string; devCode?: string }>(`/portal/${slug}/login`, body),
    // Step 2: verify the OTP → returns the session token.
    verifyOtp: (slug: string, body: { phone: string; code: string }) =>
              post<{ token: string; customer: { id: string; name: string }; isNew: boolean; referralApplied: boolean; emailBonusAwarded: number }>(`/portal/${slug}/verify-otp`, body),
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
    receipt:      (id: string)   => `/api/pos/receipt/${id}`,
    walletLookup: (phone: string) => get<any>(`/pos/wallet-lookup?phone=${encodeURIComponent(phone)}`),
    walletRedeem: (body: { customerId: string; pointsToRedeem: number; amountDeducted: number }) => post<any>('/pos/wallet-redeem', body),
    giftCreditRedeem: (body: { customerId: string; amount: number }) => post<any>('/pos/giftcredit-redeem', body),
    giftCardLookup: (code: string) => get<any>(`/pos/giftcard-lookup?code=${encodeURIComponent(code)}`),
    giftCardRedeem: (body: { customerId: string; code: string }) => post<any>('/pos/giftcard-redeem', body),
  },
};
