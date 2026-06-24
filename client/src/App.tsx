import React, { useState, useEffect, lazy, Suspense } from 'react';

const LoyalyAdminPanel = lazy(() => import('./LoyableAdminPanel'));
const CRM = lazy(() => import('./CRM'));
const CustomerPortal = lazy(() => import('./CustomerPortal'));

type Role = 'PLATFORM_ADMINISTRATOR' | 'TENANT_OWNER' | 'BRANCH_MANAGER' | 'CASHIER' | 'MARKETING_STAFF' | 'CUSTOMER' | null;

const isPortal = window.location.pathname.startsWith('/portal');
// Owner/SaaS-operator console — served on its own path (and its own dev port, see
// `npm run admin:dev` → http://localhost:3002/admin). Forces the admin panel.
const isAdmin  = window.location.pathname.startsWith('/admin');

function AdminOrCRM() {
  const [role, setRole] = useState<Role>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const storedRole = localStorage.getItem('userRole') as Role;
    const token      = localStorage.getItem('accessToken');
    if (token && storedRole) setRole(storedRole);
    setChecked(true);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('sessionId');
    localStorage.removeItem('userId');
    setRole(null);
  };

  if (!checked) return null;
  if (role === 'PLATFORM_ADMINISTRATOR') return <Suspense fallback={<PageLoader />}><LoyalyAdminPanel /></Suspense>;
  return <Suspense fallback={<PageLoader />}><CRM onLogout={handleLogout} onRoleChange={(r: string) => setRole(r as Role)} /></Suspense>;
}

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f17', flexDirection: 'column', gap: 16 }}>
      <img src="/white.png" alt="The Loyaly" style={{ width: 120, opacity: 0.9 }} />
      <div style={{ width: 200, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)', borderRadius: 2, animation: 'slide 1.2s ease-in-out infinite' }} />
      </div>
      <style>{`@keyframes slide { 0% { width: 0%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } 100% { width: 0%; margin-left: 100%; } }`}</style>
    </div>
  );
}

export default function App() {
  if (isPortal) return <Suspense fallback={<PageLoader />}><CustomerPortal /></Suspense>;
  if (isAdmin)  return <Suspense fallback={<PageLoader />}><LoyalyAdminPanel /></Suspense>;
  return <AdminOrCRM />;
}
