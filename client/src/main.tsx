import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the PWA service worker in production only. In dev it can interfere
// with Vite HMR, so we skip it (and unregister any stale worker).
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // When a new worker takes control, reload once so the user immediately sees
    // the freshly deployed build (critical for mobile/PWA where the old shell
    // can otherwise linger). Guard against reload loops.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      // updateViaCache:'none' forces the browser to revalidate sw.js every time
      // instead of serving it from the HTTP cache (which can be up to 24h stale).
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
        // Proactively check for an updated worker on each load.
        reg.update().catch(() => {});
        // If one is already waiting, activate it now.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch((err) => {
        console.warn('[pwa] service worker registration failed:', err);
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  }
}
