// 서비스 워커: 앱 파일을 기기에 저장해 두고 인터넷 없이도 열리게 해요.
// 앱을 고칠 때마다 VERSION 숫자를 올리면, 다음에 열 때 "새 버전" 알림이 떠요.
const VERSION = 'v3';
const CACHE = 'wrongnote-' + VERSION;
const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/schedule.js',
  './js/stats.js',
  './js/backup.js',
  './js/image.js',
  './js/pen.js',
  './js/ui.js',
  './js/help.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('wrongnote-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
