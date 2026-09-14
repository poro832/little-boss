import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveTheme, readStoredTheme, writeStoredTheme } from './theme';

describe('resolveTheme', () => {
  it('명시적으로 light면 시스템과 무관하게 light', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('명시적으로 dark면 시스템과 무관하게 dark', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('system이면 시스템 설정을 따른다', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('저장값이 없거나 이상하면 시스템을 따른다', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('rainbow', false)).toBe('light');
  });
});

describe('readStoredTheme', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      getItem: vi.fn(() => 'dark'),
      setItem: vi.fn(),
    };
  });

  it('저장된 값을 읽는다', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('localStorage가 throw하면 system으로 폴백한다', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readStoredTheme()).toBe('system');
  });
});

describe('writeStoredTheme', () => {
  it('localStorage가 throw해도 예외를 밖으로 던지지 않는다', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(() => writeStoredTheme('dark')).not.toThrow();
  });
});
