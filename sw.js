
'use strict';

// MARLOWE WEALTH
// Version: V26.1113
// iPhone PWA Service Worker

const CACHE = 'marlowe-wealth-v26.1113';

const APP_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest'
];

// 安裝：預先快取網站主要檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// 啟用：清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key !== CACHE &&
              (
                key.startsWith('marlowe-wealth-') ||
                key.startsWith('wealth-v')
              )
            )
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

// 網路優先，離線時使用快取
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 不攔截其他網站的請求
  if (url.origin !== self.location.origin) return;

  // 行情檔：永遠優先網路，不使用舊快取冒充最新行情
  if (url.pathname.endsWith('/market.json')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
    );
    return;
  }

  // 只處理 WEALTH 專案路徑
  const scope = new URL(self.registration.scope);

  if (!url.pathname.startsWith(scope.pathname)) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // 優先取得最新網站資源
        const response = await fetch(request, {
          cache: 'no-store'
        });

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }

        return response;

      } catch (error) {
        const cached = await caches.match(request, {
          ignoreSearch: true
        });

        if (cached) return cached;

        // 網站首頁離線時，回退到 index.html
        if (request.mode === 'navigate') {
          const fallback = await caches.match(
            new URL('./index.html', scope).href
          );

          if (fallback) return fallback;
        }

        return Response.error();
      }
    })()
  );
});
