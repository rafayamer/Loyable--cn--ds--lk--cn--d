import React, { useState, useEffect } from 'react';
import LoyableAdminPanel from './LoyableAdminPanel';
import CRM from './CRM';

type Role = 'PLATFORM_ADMINISTRATOR' | 'TENANT_OWNER' | 'BRANCH_MANAGER' | 'CASHIER' | 'MARKETING_STAFF' | 'CUSTOMER' | null;

export default function App() {
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

  if (role === 'PLATFORM_ADMINISTRATOR') return <LoyableAdminPanel />;

  // Not logged in OR tenant roles → CRM handles landing page + login + signup
  return (
    <CRM
      onLogout={handleLogout}
      onRoleChange={(r: string) => setRole(r as Role)}
    />
  );
}
