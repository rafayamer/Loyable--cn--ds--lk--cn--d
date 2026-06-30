// ================================================================
//  MarketingApp — the public 4-page motion website (Home/Product/
//  Pricing/About) plus auth routes (/login, /signup) that reuse the
//  existing in-CRM auth via LandingPage's initialView. Mounted from
//  App.tsx only for logged-out marketing paths.
// ================================================================
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, m } from 'framer-motion';
import { MotionProvider, pageVariants } from '../design/motion';
import { useTheme } from './theme';
import { MarketingNav } from './MarketingNav';
import { MarketingFooter } from './MarketingFooter';
import Home from './pages/Home';
import Product from './pages/Product';
import Pricing from './pages/Pricing';
import About from './pages/About';

// Auth reuses the existing LandingPage (lives in CRM.tsx). Lazy so the heavy
// CRM bundle only loads when a visitor actually opens /login or /signup.
const AuthLanding = lazy(() => import('../CRM').then(m => ({ default: m.LandingPage })));

const onAuthSuccess = () => { window.location.assign('/'); };

function Page({ children }: { children: React.ReactNode }) {
  return <m.main variants={pageVariants} initial="initial" animate="enter" exit="exit">{children}</m.main>;
}

function Shell() {
  const { dark, toggle, t } = useTheme();
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/signup';

  // Auth pages render the existing split-screen LandingPage (its own chrome).
  if (isAuth) {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: t.bg }} />}>
        <AuthLanding onLogin={onAuthSuccess} onExitAuth={() => window.location.assign('/')}
          initialView={location.pathname === '/signup' ? 'signup' : 'login'} />
      </Suspense>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.tx, transition: 'background .3s, color .3s' }} className="overflow-x-hidden">
      <MarketingNav t={t} dark={dark} toggle={toggle} />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Page><Home t={t} dark={dark} /></Page>} />
          <Route path="/product" element={<Page><Product t={t} dark={dark} /></Page>} />
          <Route path="/pricing" element={<Page><Pricing t={t} dark={dark} /></Page>} />
          <Route path="/about" element={<Page><About t={t} dark={dark} /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
      <MarketingFooter t={t} dark={dark} />
    </div>
  );
}

export default function MarketingApp() {
  return (
    <MotionProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </MotionProvider>
  );
}
