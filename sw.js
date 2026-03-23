/**
 * sw.js — Cue Service Worker
 * Cache-first strategy with network fallback.
 * Enables offline support for all app shell resources.
 */

const CACHE_NAME   = 'cue-v1';
const OFFLINE_URL  = '/offline.html';

// All files to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/lock.html',
  '/moments.html',
  '/habits.html',
  '/progress.html',
  '/settings.html',
  '/css/app.css',
  '/js/auth.js',
  '/js/db.js',
  '/js/ai.js',
  '/js/moments.js',
  '/js/habits.js',
  '/js/progress.js',
  '/js/settings.js',
  '/js/lock.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// ── Fetch — Cache-first with network fallback ──────────────
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and cross-origin requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip Supabase and Anthropic API calls (always network)
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('anthropic.com')) return;
  if (url.hostname.includes('googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached + fetch update in background (stale-while-revalidate)
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        }).catch(() => {/* ignore */});

        return cached;
      }

      // Not in cache — fetch from network
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        return response;
      }).catch(() => {
        // For HTML navigations, show minimal offline page
        if (event.request.destination === 'document') {
          return new Response(
            `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cue — Offline</title>
  <style>
    body { margin:0; background:#000; color:#e2e2e2; font-family:'Inter',sans-serif;
           display:flex; flex-direction:column; align-items:center; justify-content:center;
           min-height:100dvh; gap:16px; }
    h1 { font-size:48px; font-weight:800; color:#22c55e; margin:0; letter-spacing:-0.04em; }
    p  { color:#869585; font-size:14px; }
  </style>
</head>
<body>
  <h1>Cue</h1>
  <p>You're offline. Open the app when connected.</p>
</body>
</html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      });
    })
  );
});

// ── Background sync (future) ───────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'habit-sync') {
    event.waitUntil(syncPendingLogs());
  }
});

async function syncPendingLogs() {
  // Future: read pending habit logs from IndexedDB and sync to Supabase
  const db = await openDB();
  // Placeholder for offline queue processing
}

function openDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('cue-offline', 1);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendingLogs')) {
        db.createObjectStore('pendingLogs', { autoIncrement: true });
      }
    };
  });
}
