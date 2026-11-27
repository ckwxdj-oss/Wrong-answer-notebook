// 서비스 워커: 앱 파일을 기기에 저장해 두고 인터넷 없이도 열리게 해요.
// 또, 앱을 열지 않아도 하루에 한 번쯤 복습할 게 있는지 확인해서 알림을 보내요.
// 앱을 고칠 때마다 VERSION 숫자를 올리면, 다음에 열 때 "새 버전" 알림이 떠요.
//
// ⚠️ 이 파일은 일부러 import를 쓰지 않아요(예전 버전 앱이 업데이트를 받을 수 있도록).
//    아래 날짜 계산 함수는 js/schedule.js와 같은 내용이에요. 그쪽을 고치면 여기도 같이 고쳐요.
const VERSION = 'v7';

const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function diffDays(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
const RESULTS = ['correct', 'vague', 'wrong'];
const isDue = (p, today) => p.stage !== 'graduated' && !!p.dueDate && p.dueDate <= today;
const overdueDays = (p, today) => (p.stage === 'graduated' || !p.dueDate ? 0 : Math.max(0, diffDays(p.dueDate, today)));
function dailyQueue(problems, today, max) {
  const due = problems.filter((p) => isDue(p, today)).sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
  let doneToday = 0;
  problems.forEach((p) => (p.reviews || []).forEach((r) => { if (r.date === today && RESULTS.includes(r.result)) doneToday++; }));
  const remaining = Math.max(0, max - doneToday);
  return { queue: due.slice(0, remaining), deferred: due.slice(remaining), doneToday };
}
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
  // 설정의 "테스트 알림" 버튼 (TEST_NOTIFY) / 지금 바로 확인 (CHECK_NOW)
  if (e.data === 'TEST_NOTIFY' || e.data === 'CHECK_NOW') {
    e.waitUntil(checkAndNotify({ test: e.data === 'TEST_NOTIFY' })
      .then((r) => e.source?.postMessage({ type: 'notify-result', ...r }))
      .catch((err) => e.source?.postMessage({ type: 'notify-result', sent: false, reason: err.message })));
  }
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

// ---------- 복습 알림 ----------
const NOTIFY_START = 7;  // 아침 7시부터
const NOTIFY_END = 22;   // 밤 10시 전까지

/** 데이터베이스 열기 (없으면 null — 새로 만들지 않음) */
function openDB(name) {
  return new Promise((resolve) => {
    const r = indexedDB.open(name);
    r.onupgradeneeded = () => r.transaction.abort();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}
const getAll = (d, store) => new Promise((resolve, reject) => {
  const q = d.transaction(store).objectStore(store).getAll();
  q.onsuccess = () => resolve(q.result);
  q.onerror = () => reject(q.error);
});
const getSetting = (d, key, fallback) => new Promise((resolve) => {
  const q = d.transaction('settings').objectStore('settings').get(key);
  q.onsuccess = () => resolve(q.result === undefined ? fallback : q.result.value);
  q.onerror = () => resolve(fallback);
});
const putSetting = (d, key, value) => new Promise((resolve) => {
  const t = d.transaction('settings', 'readwrite');
  t.objectStore('settings').put({ key, value });
  t.oncomplete = resolve;
  t.onerror = resolve;
});

/**
 * 오늘 복습할 게 있으면 알림 보내기
 *  test: true면 "테스트 알림" (시간·하루 한 번 제한 없이 바로 보냄)
 */
async function checkAndNotify({ test = false } = {}) {
  const main = await openDB('wrongnote');
  if (!main) return { sent: false, reason: 'no-data' };
  try {
    if (!test && !(await getSetting(main, 'notifyOn', false))) return { sent: false, reason: 'off' };
    // 테스트 모드가 켜져 있으면 앱과 똑같이 테스트 데이터·테스트 날짜로 확인
    let d = main;
    let today = toDateStr(new Date());
    let testDb = null;
    if (await getSetting(main, 'testMode', false)) {
      testDb = await openDB('wrongnote-test');
      if (testDb) { d = testDb; today = await getSetting(testDb, 'testToday', today); }
    }
    const problems = await getAll(d, 'problems');
    const max = await getSetting(d, 'dailyMax', 10);
    testDb?.close();
    const { queue } = dailyQueue(problems, today, max);

    if (!test) {
      if (!queue.length) return { sent: false, reason: 'none' };
      const hour = new Date().getHours();
      if (hour < NOTIFY_START || hour >= NOTIFY_END) return { sent: false, reason: 'night' };
      if ((await getSetting(main, 'lastNotified', null)) === today) return { sent: false, reason: 'already' };
    }

    const late = queue.filter((p) => overdueDays(p, today) > 0).length;
    const title = queue.length ? `📚 오늘 복습할 오답이 ${queue.length}개 있어요` : '📚 오늘은 복습할 오답이 없어요';
    const body = queue.length
      ? (late ? `그중 ${late}개는 날짜가 지났어요. ` : '') + '눌러서 바로 복습을 시작해요!'
      : '알림이 잘 와요. 복습할 게 생기면 이렇게 알려줄게요.';
    await self.registration.showNotification(title + (test ? ' (테스트)' : ''), {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'daily-review',
      data: { path: queue.length ? 'review' : 'home' },
    });
    if (!test) await putSetting(main, 'lastNotified', today);
    return { sent: true, count: queue.length };
  } finally {
    main.close();
  }
}

// 크롬이 하루에 한 번쯤 깨워줄 때 (홈 화면에 설치한 앱에서만)
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'daily-review') e.waitUntil(checkAndNotify());
});

// 알림을 누르면 앱을 열고 복습 화면으로
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const path = e.notification.data?.path || 'home';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        w.postMessage({ type: 'go', path });
        return w.focus();
      }
    }
    return self.clients.openWindow(new URL('./#' + path, self.registration.scope).href);
  })());
});
