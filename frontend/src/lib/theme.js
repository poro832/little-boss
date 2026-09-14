const KEY = 'theme';
const VALID = ['light', 'dark', 'system'];

export function resolveTheme(stored, systemPrefersDark) {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeStoredTheme(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // 프라이빗 창·사이트 데이터 차단 환경. 이번 세션에만 적용되고 끝난다.
  }
}

// <html data-theme>를 설정한다. 'system'이면 속성을 지워 미디어쿼리가 결정하게 둔다.
export function applyTheme(stored) {
  const root = document.documentElement;
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  else root.removeAttribute('data-theme');
}
