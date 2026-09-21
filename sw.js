/**
 * sw.js — Cashly PWA Service Worker
 * ============================================================
 * Provides offline caching for core app shell assets and
 * network-first handling for all application code & dynamic data.
 * ============================================================
 */

const CACHE_NAME = 'cashly-cache-v20';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/pages.css',
  '/js/supabase.js',
  '/js/reconciliation.js',
  '/js/provider.js',
  '/js/data.js',
  '/js/patterns.js',
  '/js/cashflow.js',
  '/js/scenarios.js',
  '/js/goals.js',
  '/js/budgets.js',
  '/js/kpi.js',
  '/js/cashflow-calendar.js',
  '/js/action-center.js',
  '/js/action-tracking.js',
  '/js/payment-readiness.js',
  '/js/cash-planning.js',
  '/js/mitigation.js',
  '/js/statement.js',
  '/js/settlement.js',
  '/js/collections.js',
  '/js/risk.js',
  '/js/decision-workspace.js',
  '/js/router.js',
  '/js/dashboard.js',
  '/js/transactions.js',
  '/js/payments.js',
  '/js/reports.js',
  '/js/addtransaction.js',
  '/js/connectaccount.js',
  '/js/settings.js',
  '/js/advisor.js',
  '/js/admin.js',
  '/js/alerts.js',
  '/js/auth.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install: Cache core application assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Cashly SW] Pre-caching offline app shell');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Cashly SW] Non-fatal caching issue on install:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Immediately clean up all obsolete caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Cashly SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET requests (mutations, posts, etc.)
  if (req.method !== 'GET') {
    return;
  }

  // Network-only / pass-through for Supabase API requests and auth
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-first for local navigation and code (HTML, JS, CSS)
  // Ensures updates are visible immediately while online, falling back to cache when offline
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('/index.html');
            return null;
          });
        })
    );
    return;
  }

  // Static images, fonts, CDNs: Cache first, then network fallback
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      });
    })
  );
});
