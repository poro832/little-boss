import { describe, it, expect, beforeEach } from 'vitest';
import { shouldShowOnboarding, markOnboarded, resetOnboarding, ONBOARD_STEPS } from './onboarding';

// jsdom을 쓰지 않는 프로젝트라 auth.test.js와 같은 방식으로 스텁한다.
function stubStorage({ throwOnSet = false, throwOnGet = false } = {}) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => { if (throwOnGet) throw new Error('blocked'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceededError'); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return store;
}

describe('온보딩 표시 여부', () => {
  beforeEach(() => stubStorage());

  it('처음 방문하면 보여준다', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('한 번 본 뒤에는 보여주지 않는다', () => {
    markOnboarded();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('다시 보기를 누르면 다시 보여준다', () => {
    markOnboarded();
    resetOnboarding();
    expect(shouldShowOnboarding()).toBe(true);
  });

  // 저장이 막힌 브라우저에서 매번 온보딩이 뜨면 앱을 쓸 수 없다.
  it('저장이 막혀 있으면 보여주지 않는다', () => {
    stubStorage({ throwOnSet: true });
    expect(() => markOnboarded()).not.toThrow();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('읽기가 막혀 있어도 던지지 않고 건너뛴다', () => {
    stubStorage({ throwOnGet: true });
    expect(() => shouldShowOnboarding()).not.toThrow();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('reset도 막힌 환경에서 던지지 않는다', () => {
    stubStorage({ throwOnSet: true });
    expect(() => resetOnboarding()).not.toThrow();
  });
});

describe('온보딩 단계', () => {
  it('3단계이고 각 단계에 제목과 설명이 있다', () => {
    expect(ONBOARD_STEPS).toHaveLength(3);
    ONBOARD_STEPS.forEach((s) => {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.desc.length).toBeGreaterThan(0);
      expect(s.icon).toBeTruthy();
    });
  });
});
