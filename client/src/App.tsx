import React, { useState, useEffect } from 'react';
import LoyableAdminPanel from './LoyableAdminPanel';
import CRM from './CRM';

type Role = 'PLATFORM_ADMINISTRATOR' | 'TENANT_OWNER' | 'BRANCH_MANAGER' | 'CASHIER' | 'MARKETING_STAFF' | 'CUSTOMER' | null;

function LoginPage({ onLogin }: { onLogin: (role: Role) => void }) {
  const [email, setEmail]       = useState('owner@coffeehouse.com');
  const [password, setPassword] = useState('Owner@123!');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? 'Login failed');
      const token = data.accessToken ?? data.token ?? '';
      localStorage.setItem('accessToken', token);
      localStorage.setItem('userRole', data.user?.role ?? '');
      onLogin(data.user?.role ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:'linear-gradient(135deg,#0a0615,#1a0f2e,#0d1525)'}}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{background:'linear-gradient(135deg,#8b5cf6,#06b6d4)'}}>
            <span className="text-white font-bold text-2xl">L</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Loyable</h1>
          <p className="text-slate-400 text-sm mt-1">WhatsApp Retention Platform</p>
        </div>
        <div className="rounded-2xl p-6" style={{background:'rgba(20,15,35,0.9)',border:'1px solid rgba(255,255,255,0.08)'}}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)'}} />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)'}} />
            </div>
            {error && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-400" style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)'}}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{background:'linear-gradient(135deg,#8b5cf6,#7c3aed)'}}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <div className="mt-4 p-3 rounded-lg space-y-1" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
            <p className="text-xs text-slate-500 font-medium">Quick access:</p>
            <button onClick={()=>{setEmail('admin@cuberetain.com');setPassword('Admin@123!');}} className="text-xs text-slate-400 hover:text-violet-400 block">
              👑 Platform Admin — admin@cuberetain.com / Admin@123!
            </button>
            <button onClick={()=>{setEmail('owner@coffeehouse.com');setPassword('Owner@123!');}} className="text-xs text-slate-400 hover:text-cyan-400 block">
              ☕ Tenant Owner — owner@coffeehouse.com / Owner@123!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState<Role>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const storedRole = localStorage.getItem('userRole') as Role;
    const token      = localStorage.getItem('accessToken');
    if (token && storedRole) {
      setRole(storedRole);
    }
    setChecked(true);
  }, []);

  const handleLogin = (r: Role) => setRole(r);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('userRole');
    setRole(null);
  };

  if (!checked) return null;

  if (!role) return <LoginPage onLogin={handleLogin} />;

  if (role === 'PLATFORM_ADMINISTRATOR') {
    return <LoyableAdminPanel />;
  }

  // TENANT_OWNER, BRANCH_MANAGER, CASHIER, MARKETING_STAFF → CRM
  return <CRM onLogout={handleLogout} />;
}
