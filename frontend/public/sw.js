/* LittleBoss 서비스워커
 *
 * 두 가지 일을 한다.
 *  1) 앱 골격(HTML/JS/CSS/아이콘)을 캐시해 오프라인에서도 화면이 뜨게 한다.
 *     마감 요약 자체는 앱이 localStorage에 넣는다 — 서비스워커는 localStorage를
 *     읽을 수 없지만, 골격만 캐시돼 있으면 앱 JS가 떠서 그걸 읽어준다.
 *  2) 서버가 보낸 마감 푸시를 받아 OS 알림으로 띄우고, 클릭하면 해당 문서로 보낸다.
 *
 * 이 파일은 Vite가 건드리지 않는 public/ 에 있어 해시 없이 고정 경로로 배포된다.
 * 스코프는 자기 위치 기준이므로 /little-boss/sw.js 는 /little-boss/ 전체를 제어한다.
 */

const VERSION = 'lb-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// 등록 위치에서 배포 base를 얻는다. 로컬('/')과 GitHub Pages('/little-boss/') 양쪽에서 동작.
const BASE = new URL('./', self.registration.scope).pathname;

const SHELL = [
  `${BASE}app.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icon-192.png`,
];

self.addEventListener('install', (e) => {
  // 개별 실패가 전체 설치를 막지 않도록 하나씩 담는다.
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // API·폰트 등 외부는 그대로 통과
  if (url.pathname.startsWith(`${BASE}api/`)) return;

  // 화면 이동: 네트워크 우선, 끊기면 캐시된 앱 셸로 (오프라인에서도 앱이 뜬다)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match(`${BASE}app.html`).then((r) => r || Response.error()))
    );
    return;
  }

  // 정적 자산: 캐시 우선. Vite 산출물은 파일명에 해시가 있어 갱신 시 URL이 바뀐다.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }

  const title = d.title || '마감이 다가옵니다';
  const options = {
    body: d.body || '',
    icon: `${BASE}icon-192.png`,
    badge: `${BASE}icon-192.png`,
    lang: 'ko',
    // 같은 문서의 알림이 쌓이지 않게 문서 단위로 교체한다.
    tag: d.tag || 'lb-deadline',
    renotify: true,
    data: { url: d.url || `${BASE}app.html?page=app&sub=sub-schedule` },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || `${BASE}app.html`;

  // 이미 열린 창이 있으면 새 창을 열지 않고 그쪽으로 이동시킨다.
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(BASE) && 'focus' in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
