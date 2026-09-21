import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  urlBase64ToUint8Array,
  pushSupport,
  cacheDeadlineSummary,
  readDeadlineSummary,
} from './push';

describe('urlBase64ToUint8Array', () => {
  // VAPID 공개키는 URL-safe base64(패딩 없음)로 오는데 PushManager는 Uint8Array를 요구한다.
  it('URL-safe 문자(-, _)를 표준 base64로 되돌린다', () => {
    // '-' -> '+', '_' -> '/' 로 바꿨을 때와 같은 바이트가 나와야 한다
    const urlSafe = 'A-B_';
    const std = atob('A+B/');
    const out = urlBase64ToUint8Array(urlSafe);
    expect(Array.from(out)).toEqual(Array.from(std, (c) => c.charCodeAt(0)));
  });

  it('패딩이 빠진 문자열도 복원한다', () => {
    // 길이 %4 == 2 -> '==' 를 붙여야 디코딩된다
    const out = urlBase64ToUint8Array('AA');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(1);
  });

  it('실제 길이의 VAPID 키(65바이트)를 그대로 복원한다', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 7) % 256);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(Array.from(urlBase64ToUint8Array(b64))).toEqual(Array.from(bytes));
  });

  it('빈 문자열이면 빈 배열', () => {
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });
});

describe('pushSupport', () => {
  const orig = {};
  beforeEach(() => {
    orig.sw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    orig.standalone = navigator.standalone;
  });
  afterEach(() => {
    if (orig.sw) Object.defineProperty(navigator, 'serviceWorker', orig.sw);
    vi.unstubAllGlobals();
  });

  const setEnv = ({ sw = true, pm = true, notif = true, ua = 'Chrome', standalone = undefined }) => {
    if (sw) Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    else Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    vi.stubGlobal('PushManager', pm ? function () {} : undefined);
    vi.stubGlobal('Notification', notif ? function () {} : undefined);
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
  };

  it('필요한 API가 다 있으면 지원으로 본다', () => {
    setEnv({});
    expect(pushSupport().supported).toBe(true);
  });

  it('PushManager가 없으면 미지원', () => {
    setEnv({ pm: false });
    expect(pushSupport().supported).toBe(false);
  });

  it('서비스워커가 없으면 미지원', () => {
    setEnv({ sw: false });
    expect(pushSupport().supported).toBe(false);
  });

  // iOS는 홈 화면에 추가한 PWA에서만 푸시가 된다. Safari 탭이면 설치를 먼저 안내해야 한다.
  it('iOS Safari 탭이면 홈 화면 추가가 먼저 필요하다고 알린다', () => {
    setEnv({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', standalone: false });
    const r = pushSupport();
    expect(r.needsInstall).toBe(true);
  });

  it('iOS라도 홈 화면에서 실행 중이면 설치 안내가 필요 없다', () => {
    setEnv({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', standalone: true });
    expect(pushSupport().needsInstall).toBe(false);
  });

  it('iOS가 아니면 설치 안내를 띄우지 않는다', () => {
    setEnv({ ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/153' });
    expect(pushSupport().needsInstall).toBe(false);
  });
});

// jsdom을 쓰지 않는 프로젝트라 auth.test.js와 같은 방식으로 localStorage를 스텁한다.
function stubStorage({ throwOnSet = false } = {}) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('QuotaExceededError');
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
  return store;
}

describe('마감 요약 오프라인 캐시', () => {
  beforeEach(() => stubStorage());

  it('저장한 요약을 그대로 돌려준다', () => {
    cacheDeadlineSummary([{ title: '장학금 신청', date: '2026-10-01' }]);
    const r = readDeadlineSummary();
    expect(r.items).toHaveLength(1);
    expect(r.items[0].title).toBe('장학금 신청');
    expect(r.syncedAt).toBeTruthy();
  });

  it('제목·날짜·doc_id만 남기고 나머지 필드는 버린다', () => {
    // 기기에 남기는 데이터를 최소화한다 (공용 PC 대비)
    cacheDeadlineSummary([
      { title: '장학금', date: '2026-10-01', doc_id: 'd1', ssn: '900101-1234567', memo: '비밀' },
    ]);
    const item = readDeadlineSummary().items[0];
    expect(Object.keys(item).sort()).toEqual(['date', 'doc_id', 'title']);
    expect(JSON.stringify(item)).not.toContain('900101');
  });

  it('최대 5건만 저장한다', () => {
    cacheDeadlineSummary(Array.from({ length: 12 }, (_, i) => ({ title: `d${i}`, date: '2026-10-01' })));
    expect(readDeadlineSummary().items).toHaveLength(5);
  });

  it('저장된 적 없으면 빈 결과를 준다', () => {
    const r = readDeadlineSummary();
    expect(r.items).toEqual([]);
    expect(r.syncedAt).toBe(null);
  });

  it('값이 깨져 있어도 던지지 않는다', () => {
    globalThis.localStorage.setItem('deadline_summary', '{누가 봐도 JSON 아님');
    expect(() => readDeadlineSummary()).not.toThrow();
    expect(readDeadlineSummary().items).toEqual([]);
  });

  it('localStorage가 막혀 있어도 저장이 던지지 않는다', () => {
    stubStorage({ throwOnSet: true });
    expect(() => cacheDeadlineSummary([{ title: 'a', date: '2026-10-01' }])).not.toThrow();
  });

  it('항목이 없으면 빈 목록으로 저장한다', () => {
    cacheDeadlineSummary(undefined);
    expect(readDeadlineSummary().items).toEqual([]);
  });
});
