import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA service worker REMOVED. The cache layer was repeatedly serving stale
// builds after deploys (a controlling service worker is not bypassed by a hard
// refresh), so we no longer register one. We also actively unregister any
// previously-installed worker and clear its caches, so every returning browser
// self-heals to the live build on its next visit. /sw.js is now a self-destruct
// worker (see client/public/sw.js) as a second line of defence.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (typeof caches !== 'undefined' && caches.keys) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
}
