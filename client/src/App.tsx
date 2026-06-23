import React, { useState, useEffect } from 'react';
import The LoyalyAdminPanel from './The LoyalyAdminPanel';
import CRM from './CRM';
import CustomerPortal from './CustomerPortal';

type Role = 'PLATFORM_ADMINISTRATOR' | 'TENANT_OWNER' | 'BRANCH_MANAGER' | 'CASHIER' | 'MARKETING_STAFF' | 'CUSTOMER' | null;

const isPortal = window.location.pathname.startsWith('/portal');

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
  if (role === 'PLATFORM_ADMINISTRATOR') return <The LoyalyAdminPanel />;
  return <CRM onLogout={handleLogout} onRoleChange={(r: string) => setRole(r as Role)} />;
}

export default function App() {
  if (isPortal) return <CustomerPortal />;
  return <AdminOrCRM />;
}
