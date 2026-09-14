import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearSession } from './auth';

describe('clearSession', () => {
  beforeEach(() => {
    const store = {
      user_id: '1', user_email: 'a@b.com', user_name: '이동찬', user_affiliation: '학교',
      user_token: 'tok', dismissed_notifs: '["x"]', profileImage: 'data:...',
      theme: 'dark',
    };
    globalThis.localStorage = {
      getItem: vi.fn((k) => (k in store ? store[k] : null)),
      setItem: vi.fn((k, v) => { store[k] = v; }),
      removeItem: vi.fn((k) => { delete store[k]; }),
      clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
      _store: store,
    };
  });

  it('세션 관련 키를 전부 지운다', () => {
    clearSession();
    const store = globalThis.localStorage._store;
    expect(store.user_id).toBeUndefined();
    expect(store.user_email).toBeUndefined();
    expect(store.user_name).toBeUndefined();
    expect(store.user_affiliation).toBeUndefined();
    expect(store.user_token).toBeUndefined();
    expect(store.dismissed_notifs).toBeUndefined();
    expect(store.profileImage).toBeUndefined();
  });

  it('theme은 건드리지 않는다', () => {
    clearSession();
    expect(globalThis.localStorage._store.theme).toBe('dark');
  });

  it('localStorage가 throw해도 예외를 밖으로 던지지 않는다', () => {
    globalThis.localStorage = {
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(() => clearSession()).not.toThrow();
  });
});
