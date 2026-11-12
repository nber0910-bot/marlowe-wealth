
'use strict';

// MARLOWE WEALTH V3.5
// Service Worker：離線快取與版本更新

const CACHE = 'marlowe-wealth-v35-20261113';

const APP_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest'
];

// 安裝新版 Service Worker
self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(APP_FILES)
    )
  );
});

// 啟用新版並清除舊版網站快取
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key =>
            (key.startsWith('marlowe-wealth-') ||
             key.startsWith('wealth-')) &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

// 網站檔案優先讀取網路最新版
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 不攔截外部網站
  if (url.origin !== self.location.origin) return;

  // 行情資料永遠優先取得最新版本
  if (url.pathname.endsWith('/market.json')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
    );
    return;
  }

  // 其他網站檔案：網路優先，離線時使用快取
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        const cached = await caches.match(request);

        if (cached) return cached;

        // 離線開啟網站時，回傳首頁
        if (request.mode === 'navigate') {
          const homepage = await caches.match('./index.html');
          if (homepage) return homepage;
        }

        return Response.error();
      }
    })()
  );
});
