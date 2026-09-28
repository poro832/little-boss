// 웹 푸시 구독 + 오프라인 마감 요약.
//
// 알림 권한은 앱을 열 때가 아니라 사용자가 "마감 알림" 토글을 켤 때만 요청한다.
// 로드 시점에 묻는 방식은 브라우저가 차단하기도 하고, 맥락 없이 뜨면 대부분 거부한다.

import { subscribePush as apiSubscribe, unsubscribePush as apiUnsubscribe } from './api';

const SUMMARY_KEY = 'deadline_summary';
const SUMMARY_MAX = 5;

// VAPID 공개키는 URL-safe base64(패딩 없음)로 오는데 PushManager는 Uint8Array를 받는다.
export function urlBase64ToUint8Array(base64String) {
  if (!base64String) return new Uint8Array(0);
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// 이 브라우저에서 푸시가 가능한지, 가능하려면 먼저 설치가 필요한지 판단한다.
export function pushSupport() {
  const hasSW = typeof navigator !== 'undefined' && !!navigator.serviceWorker;
  const hasPM = typeof PushManager !== 'undefined';
  const hasNotif = typeof Notification !== 'undefined';
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua);

  // iOS는 홈 화면에 추가한 PWA 안에서만 푸시가 동작한다(16.4+).
  // Safari 탭에서는 권한 요청 자체가 실패하므로 설치를 먼저 안내해야 한다.
  const standalone =
    (typeof navigator !== 'undefined' && navigator.standalone === true) ||
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches);

  return {
    supported: hasSW && hasPM && hasNotif,
    needsInstall: isIOS && !standalone,
    permission: hasNotif ? Notification.permission : 'unsupported',
  };
}

export function getRegistration() {
  return navigator.serviceWorker.ready;
}

// 서비스워커 등록. 경로는 반드시 배포 base 기준이어야 한다 —
// '/sw.js'로 쓰면 GitHub Pages의 /little-boss/ 하위에서 404가 난다.
export async function registerServiceWorker() {
  if (!navigator.serviceWorker) return null;
  const base = import.meta.env.BASE_URL || '/';
  try {
    return await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  } catch {
    return null; // 등록 실패해도 앱 자체는 정상 동작해야 한다
  }
}

/** 알림 권한을 요청하고 구독을 만들어 서버에 저장한다. */
export async function enablePush(userId) {
  const s = pushSupport();
  if (s.needsInstall) return { ok: false, reason: 'needs-install' };
  if (!s.supported) return { ok: false, reason: 'unsupported' };

  // 키 확인이 권한 요청보다 먼저다. 순서가 반대면 사용자가 허용을 누른 뒤에야
  // "아직 준비되지 않았어요"를 보게 된다 — 물어놓고 무르는 꼴이다.
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, reason: 'no-key' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await apiSubscribe(userId, sub.toJSON());
  return { ok: true };
}

/** 구독을 해제하고 서버에서도 지운다. */
export async function disablePush(userId) {
  if (!navigator.serviceWorker) return { ok: true };
  try {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const { endpoint } = sub.toJSON();
    await sub.unsubscribe();
    // 서버 삭제가 실패해도 로컬 구독은 이미 끊겼다. 죽은 구독은 발송 시 410으로 정리된다.
    try { await apiUnsubscribe(userId, endpoint); } catch { /* 정리는 서버가 맡는다 */ }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** 발표·확인용 로컬 알림. 서버 없이 서비스워커가 직접 띄운다.
 *
 * 실제 마감 푸시와 같은 모양·같은 클릭 동작이라, 백엔드를 배포하기 전에도
 * "알림이 이렇게 온다"를 그대로 보여줄 수 있다. 다른 점은 서버가 아니라
 * 이 기기에서 만들어진다는 것뿐이다.
 */
export async function sendDemoNotification() {
  const s = pushSupport();
  if (s.needsInstall) return { ok: false, reason: 'needs-install' };
  if (!s.supported) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const base = import.meta.env.BASE_URL || '/';
  const reg = await getRegistration();
  await reg.showNotification('D-3 · 국가장학금 신청서', {
    body: '서류 제출 마감이 3일 남았습니다. 준비물 2건이 남아 있어요.',
    icon: `${base}icon-192.png`,
    badge: `${base}icon-192.png`,
    lang: 'ko',
    tag: 'lb-demo',
    renotify: true,
    data: { url: `${base}app.html?page=app&sub=sub-schedule` },
  });
  return { ok: true };
}

// ── 오프라인 마감 요약 ────────────────────────────────────
// 서비스워커는 localStorage를 읽지 못하지만, 앱 골격이 캐시돼 있으면
// 앱 JS가 떠서 이 값을 읽어준다. IndexedDB까지 갈 필요가 없다.

/** 조회 성공 시 호출. 제목·날짜만 남겨 기기에 남는 정보를 최소화한다. */
export function cacheDeadlineSummary(items) {
  try {
    const slim = (items || []).slice(0, SUMMARY_MAX).map((d) => ({
      title: d.title,
      date: d.date,
      doc_id: d.doc_id,
    }));
    localStorage.setItem(
      SUMMARY_KEY,
      JSON.stringify({ syncedAt: new Date().toISOString(), items: slim })
    );
  } catch {
    // 저장 공간이 막혔거나 가득 참. 오프라인 요약은 부가 기능이라 조용히 넘어간다.
  }
}

export function readDeadlineSummary() {
  try {
    const raw = localStorage.getItem(SUMMARY_KEY);
    if (!raw) return { items: [], syncedAt: null };
    const p = JSON.parse(raw);
    return {
      items: Array.isArray(p.items) ? p.items : [],
      syncedAt: p.syncedAt || null,
    };
  } catch {
    return { items: [], syncedAt: null };
  }
}
