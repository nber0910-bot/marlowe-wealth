
'use strict';

// MARLOWE WEALTH V3.4
// 更新此版本號可觸發 Service Worker 更新
const CACHE = 'wealth-v3.4-20261112';

const APP_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);

      await cache.addAll(
        APP_FILES.map(path =>
          new Request(path, {
            cache: 'reload'
          })
        )
      );
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key =>
            key.startsWith('wealth-') &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // 不攔截其他路徑的請求
  const scope = new URL(
    self.registration.scope
  );

  if (!url.pathname.startsWith(scope.pathname)) {
    return;
  }

  // 行情資料：每次向網路取得最新版本
  if (url.pathname.endsWith('/market.json')) {
    event.respondWith(
      fetch(request, {
        cache: 'no-store'
      })
    );
    return;
  }

  // HTML、JS、CSS：優先取得網路最新版
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      try {
        const response = await fetch(request, {
          cache: 'no-store'
        });

        if (response.ok) {
          await cache.put(
            request,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        const cached = await cache.match(request);

        if (cached) {
          return cached;
        }

        throw error;
      }
    })()
  );
});
