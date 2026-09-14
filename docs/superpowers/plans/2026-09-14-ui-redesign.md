# UI 전면 재설계(S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `frontend/LittleBoss.jsx` 2,466줄 단일 파일 + 인라인 스타일 487개를 CSS 변수 기반 디자인 토큰과 컴포넌트 구조로 재구성하고, 랜딩의 디자인 언어를 앱에 이식하며, 대시보드를 마감 중심(A안)으로 바꾼다.

**Architecture:** 먼저 토대(테스트 러너 → 순수 함수 → 토큰 → 아이콘 → 공통 컴포넌트 → 앱 셸)를 세우고, 그 위에 화면을 하나씩 이관한다. 각 화면 이관 태스크는 끝난 직후 `npm run dev`로 직접 띄워 확인할 수 있는 단위다. 마지막에 원본 파일을 삭제하고 랜딩과 토큰을 공유시킨다. 데이터 흐름(`useDocuments` → `toScreenDoc` → 화면)과 백엔드는 건드리지 않는다.

**Tech Stack:** React 18, Vite 4.3.9, vitest 0.34.x(Vite 4 호환), 순수 CSS(커스텀 프로퍼티). 새 런타임 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-14-ui-redesign-design.md`

## Global Constraints

- 새 런타임 의존성을 추가하지 않는다. 아이콘은 자체 SVG, 스타일은 순수 CSS. devDependency는 `vitest`만 허용.
- **vitest는 `^0.34.6`을 쓴다.** vitest 1.x는 `vite ^5.0.0`을 peer로 요구하는데 이 프로젝트는 `vite 4.3.9`다.
- 모든 색·간격·라운드·그림자는 `src/styles/tokens.css`의 CSS 변수를 통해서만 쓴다. 컴포넌트 파일에 hex 리터럴을 쓰지 않는다.
- 다크 값은 **두 곳**에 쓴다: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` 와 `:root[data-theme="dark"] { … }`. 한쪽만 쓰면 토글이 한 방향에서만 동작한다.
- 라이트 팔레트는 맨 `:root`에 전부 정의한다. 어떤 색도 미디어쿼리나 `[data-theme]` 안에서만 정의하지 않는다.
- 이모지를 UI에 쓰지 않는다(`🏠 📎 📁 📅 📋 ✅ 👤 🔍 📭 📂 🔔 📄 🗑️` 전부 제거 대상). 토스트 메시지 문구 안의 이모지도 제거한다.
- 백엔드·API Gateway·DynamoDB 변경 없음. `frontend/api.js`의 네트워크 호출 시그니처를 바꾸지 않는다.
- 라우터를 도입하지 않는다. 기존 `page`/`sub` 상태 + `history.pushState` 방식을 유지한다.
- 커밋 메시지는 한국어 한 줄 요약 + 필요 시 본문. 각 태스크 끝에서 커밋한다.

---

## File Structure

**신규 (`frontend/src/`)**

- `styles/tokens.css` — 색·간격·라운드·그림자·서체 토큰. 라이트/다크. 랜딩과 공유.
- `styles/base.css` — reset, `body` 기본, 타이포 스케일, `:focus-visible`, `@keyframes`.
- `styles/components.css` — `.btn` `.card` `.chip` `.field` `.toggle` `.empty` `.badge` `.progress` 등 공통 클래스.
- `icons/index.jsx` — SVG 아이콘 20종 named export + 공통 래퍼.
- `lib/format.js` — 마감일 표기 단일 진실 공급원. **순수 함수, 테스트 대상.**
- `lib/format.test.js` — 위 테스트.
- `lib/theme.js` — 테마 저장/해석. **순수 함수, 테스트 대상.**
- `lib/theme.test.js` — 위 테스트.
- `lib/api.js` — 기존 `frontend/api.js` 이동(내용 거의 그대로, `ddayInfo`만 `format.js`로 이사).
- `lib/auth.js` — 세션 읽기/쓰기, 캘린더 토큰 만료 처리.
- `lib/useDocuments.js` `lib/useToast.js` `lib/useIsMobile.js` `lib/useTheme.js` — 훅 분리.
- `components/AppShell.jsx` `Header.jsx` `Sidebar.jsx`
- `components/Button.jsx` `Card.jsx` `Chip.jsx` `Field.jsx` `Toggle.jsx` `ProgressBar.jsx`
- `components/EmptyState.jsx` `Skeleton.jsx` `Toast.jsx` `ConfirmDialog.jsx`
- `pages/auth/AuthLayout.jsx` `LoginPage.jsx` `SignupPage.jsx` `ForgotPasswordPage.jsx`
- `pages/DashboardPage.jsx` `UploadPage.jsx` `SchedulePage.jsx` `OngoingPage.jsx` `CompletedPage.jsx`
- `pages/DocumentDetailPage.jsx` `ScheduleDetailPage.jsx`
- `pages/profile/ProfilePage.jsx` `ProfileInfo.jsx` `NotificationSettings.jsx` `Connections.jsx`
- `App.jsx` `main.jsx`

**수정**

- `frontend/package.json` — `vitest` devDependency + `test` 스크립트.
- `frontend/app.html` — 뷰포트, 타이틀, Figma 스크립트 제거, 테마 부트 스크립트, `src/main.jsx` 경로.
- `frontend/index.html` — `tokens.css` 참조, `--purple` 계열 → 새 토큰 이름, `data-theme="light"` 고정, 기능 카드 아이콘 교체.
- `frontend/vite.config.js` — 입력 경로 유지 확인.

**삭제**

- `frontend/LittleBoss.jsx` (Task 12에서)
- `frontend/api.js` (Task 1에서 `src/lib/api.js`로 이동)
- `frontend/main.jsx` (Task 5에서 `src/main.jsx`로 이동)

**태스크 순서:** 1(테스트 토대+format) → 2(토큰+테마) → 3(아이콘) → 4(공통 컴포넌트) → 5(앱 셸) → 6(인증) → 7(대시보드) → 8(업로드·일정) → 9(진행중·완료) → 10(상세 2종) → 11(내 정보) → 12(정리·랜딩 공유) → 13(검수)

---

## Task 1: 테스트 토대와 마감일 표기 단일화

지난 일정 표기가 화면마다 다르고 `-1149일 전` 같은 값이 보고됐다. 표기 로직을 한 곳으로 모으고, 프로젝트에서 유일하게 테스트할 가치가 있는 순수 함수이므로 여기서 테스트 러너를 함께 들인다.

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/format.js`
- Create: `frontend/src/lib/format.test.js`
- Create: `frontend/src/lib/api.js` (기존 `frontend/api.js` 이동)
- Delete: `frontend/api.js`

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces:
  - `deadlineInfo(dateStr) -> { hasDate: boolean, valid: boolean, days: number|null, isPast: boolean }`
  - `formatDeadline(dateStr) -> string` — `"D-106"` | `"D-Day"` | `"84일 지남"` | `"마감일 없음"` | `"마감일 미정"`
  - `formatDeadlineWithLabel(label, dateStr) -> string` — `"신청 마감 D-4"`, label이 falsy면 `formatDeadline` 결과만
  - `deadlineTone(dateStr) -> 'none' | 'past' | 'urgent' | 'normal'` — urgent는 `0 <= days <= 3`
  - `src/lib/api.js`는 기존 `api.js`의 모든 export를 그대로 유지하되 `ddayInfo`는 제거하고 내부에서 `format.js`를 쓴다.

- [ ] **Step 0: 작업 브랜치 생성**

현재 `docs/ui-redesign-spec` 브랜치에 스펙과 이 계획이 커밋돼 있다. 구현은 별도 브랜치에서 한다.

```bash
cd "C:/univercity/Project (Cab Stone)/littleboss"
git checkout main
git merge --no-ff docs/ui-redesign-spec -m "Merge docs/ui-redesign-spec: 설계 문서와 구현 계획"
git checkout -b feature/ui-redesign
```

- [ ] **Step 1: vitest 설치와 스크립트 추가**

```bash
cd frontend
npm install --save-dev vitest@^0.34.6
```

`frontend/package.json`의 `scripts`에 추가:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/lib/format.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deadlineInfo, formatDeadline, formatDeadlineWithLabel, deadlineTone, greeting } from './format';

// 모든 테스트를 2026-09-14로 고정한다. 실제 시간에 의존하면 내일 깨진다.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T10:30:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('formatDeadline', () => {
  it('미래 날짜는 D-N으로 표기한다', () => {
    expect(formatDeadline('2026-12-29')).toBe('D-106');
  });

  it('오늘은 D-Day로 표기한다', () => {
    expect(formatDeadline('2026-09-14')).toBe('D-Day');
  });

  it('시각이 지난 오늘도 D-Day다 (날짜 단위로만 비교)', () => {
    expect(formatDeadline('2026-09-14T01:00:00')).toBe('D-Day');
  });

  it('과거 날짜는 "N일 지남"으로 표기하며 음수 부호를 노출하지 않는다', () => {
    const out = formatDeadline('2026-06-22');
    expect(out).toBe('84일 지남');
    expect(out).not.toContain('-');
  });

  it('3년 전 같은 극단값에도 같은 규칙을 적용한다', () => {
    const out = formatDeadline('2023-07-21');
    expect(out).toMatch(/^\d+일 지남$/);
    expect(out).not.toContain('-');
  });

  it('null과 빈 문자열은 "마감일 없음"', () => {
    expect(formatDeadline(null)).toBe('마감일 없음');
    expect(formatDeadline('')).toBe('마감일 없음');
    expect(formatDeadline(undefined)).toBe('마감일 없음');
  });

  it('파싱할 수 없는 문자열은 "마감일 미정"', () => {
    expect(formatDeadline('언제까지')).toBe('마감일 미정');
    expect(formatDeadline('2026-13-45')).toBe('마감일 미정');
  });
});

describe('deadlineInfo', () => {
  it('미래 날짜의 days는 양수이고 isPast는 false', () => {
    expect(deadlineInfo('2026-12-29')).toEqual({
      hasDate: true, valid: true, days: 106, isPast: false,
    });
  });

  it('과거 날짜의 days는 음수이고 isPast는 true', () => {
    const info = deadlineInfo('2026-06-22');
    expect(info.days).toBe(-84);
    expect(info.isPast).toBe(true);
  });

  it('날짜가 없으면 hasDate가 false', () => {
    expect(deadlineInfo(null)).toEqual({
      hasDate: false, valid: false, days: null, isPast: false,
    });
  });

  it('파싱 불가면 valid가 false', () => {
    expect(deadlineInfo('언제까지')).toEqual({
      hasDate: true, valid: false, days: null, isPast: false,
    });
  });
});

describe('formatDeadlineWithLabel', () => {
  it('라벨이 있으면 앞에 붙인다', () => {
    expect(formatDeadlineWithLabel('신청 마감', '2026-09-18')).toBe('신청 마감 D-4');
  });

  it('라벨이 없으면 표기만 반환한다', () => {
    expect(formatDeadlineWithLabel('', '2026-09-18')).toBe('D-4');
    expect(formatDeadlineWithLabel(null, '2026-09-18')).toBe('D-4');
  });
});

describe('greeting', () => {
  it('시간대에 따라 인사말을 고른다', () => {
    vi.setSystemTime(new Date('2026-09-14T03:00:00'));
    expect(greeting()).toBe('늦은 시간이네요');
    vi.setSystemTime(new Date('2026-09-14T09:00:00'));
    expect(greeting()).toBe('좋은 아침입니다');
    vi.setSystemTime(new Date('2026-09-14T14:00:00'));
    expect(greeting()).toBe('좋은 오후입니다');
    vi.setSystemTime(new Date('2026-09-14T21:00:00'));
    expect(greeting()).toBe('좋은 저녁입니다');
  });
});

describe('deadlineTone', () => {
  it('3일 이내는 urgent', () => {
    expect(deadlineTone('2026-09-17')).toBe('urgent');
    expect(deadlineTone('2026-09-14')).toBe('urgent');
  });

  it('4일 이상 남으면 normal', () => {
    expect(deadlineTone('2026-09-18')).toBe('normal');
  });

  it('지났으면 past', () => {
    expect(deadlineTone('2026-06-22')).toBe('past');
  });

  it('날짜가 없거나 파싱 불가면 none', () => {
    expect(deadlineTone(null)).toBe('none');
    expect(deadlineTone('언제까지')).toBe('none');
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import "./format"`

- [ ] **Step 4: 구현**

`frontend/src/lib/format.js`:

```js
// 마감일 표기의 단일 진실 공급원.
// 화면에서 직접 날짜를 계산하거나 문자열을 조립하지 않는다.

const DAY_MS = 86400000;

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function deadlineInfo(dateStr) {
  if (!dateStr) return { hasDate: false, valid: false, days: null, isPast: false };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { hasDate: true, valid: false, days: null, isPast: false };
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  return { hasDate: true, valid: true, days, isPast: days < 0 };
}

export function formatDeadline(dateStr) {
  const info = deadlineInfo(dateStr);
  if (!info.hasDate) return '마감일 없음';
  if (!info.valid) return '마감일 미정';
  if (info.days === 0) return 'D-Day';
  if (info.days > 0) return `D-${info.days}`;
  // 과거: 부호를 절대 노출하지 않는다.
  return `${Math.abs(info.days)}일 지남`;
}

export function formatDeadlineWithLabel(label, dateStr) {
  const text = formatDeadline(dateStr);
  return label ? `${label} ${text}` : text;
}

export function deadlineTone(dateStr) {
  const info = deadlineInfo(dateStr);
  if (!info.hasDate || !info.valid) return 'none';
  if (info.isPast) return 'past';
  return info.days <= 3 ? 'urgent' : 'normal';
}

// LittleBoss.jsx:38-44에서 이동
export function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '늦은 시간이네요';
  if (h < 12) return '좋은 아침입니다';
  if (h < 18) return '좋은 오후입니다';
  return '좋은 저녁입니다';
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd frontend && npm test`
Expected: PASS — 18 tests passed

- [ ] **Step 6: api.js 이동**

```bash
cd frontend
mkdir -p src/lib
git mv api.js src/lib/api.js
```

`src/lib/api.js`에서 `ddayInfo` 함수 정의(현 `api.js:91-102`)를 **삭제**하고 파일 상단에 추가:

```js
import { deadlineInfo, formatDeadline } from './format';
```

같은 파일 안에서 `ddayInfo`를 쓰던 곳(`deadlinesForMonth` 내부, 현 `api.js:162`)을 바꾼다:

```js
const past = deadlineInfo(e.date).isPast;
```

`export function ddayInfo` 가 사라졌으므로, 이 파일에서 `ddayInfo`를 다시 export 하지 않는다. 화면들은 Task 5 이후 `format.js`에서 직접 가져온다.

> **주의:** 이 시점에서 `frontend/LittleBoss.jsx`는 `./api`에서 `ddayInfo`를 import하므로 빌드가 깨진다. 정상이다. Task 5에서 `LittleBoss.jsx`가 엔트리에서 빠질 때까지 임시로 `frontend/api.js`에 재export shim을 둔다:

`frontend/api.js` (임시 shim, Task 12에서 삭제):

```js
export * from './src/lib/api';
export { deadlineInfo as ddayInfoRaw, formatDeadline } from './src/lib/format';
// LittleBoss.jsx가 쓰던 형태를 유지하기 위한 임시 어댑터
import { deadlineInfo, formatDeadline } from './src/lib/format';
export function ddayInfo(dateStr) {
  const i = deadlineInfo(dateStr);
  return { text: formatDeadline(dateStr), isPast: i.isPast, days: i.days };
}
```

- [ ] **Step 7: 빌드가 통과하는지 확인**

Run: `cd frontend && npm run build`
Expected: 성공. `dist/` 생성.

- [ ] **Step 8: 커밋**

```bash
cd frontend
git add package.json package-lock.json src/lib/format.js src/lib/format.test.js src/lib/api.js api.js
git commit -m "feat(format): 마감일 표기 단일화 + vitest 도입

- deadlineInfo/formatDeadline/formatDeadlineWithLabel/deadlineTone 신설
- 과거 날짜에 음수 부호가 노출되지 않도록 보장(테스트 포함)
- api.js를 src/lib로 이동, 기존 호출부용 임시 shim 유지"
```

---

## Task 2: 디자인 토큰과 테마

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/base.css`
- Create: `frontend/src/lib/theme.js`
- Create: `frontend/src/lib/theme.test.js`
- Create: `frontend/src/lib/useTheme.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `resolveTheme(stored, systemPrefersDark) -> 'light' | 'dark'`
  - `readStoredTheme() -> 'light' | 'dark' | 'system'`
  - `writeStoredTheme(value) -> void`
  - `applyTheme(stored) -> void` — `<html data-theme>` 설정
  - `useTheme() -> { theme, setTheme }` — theme은 `'light'|'dark'|'system'`
  - CSS 변수 전체(아래 tokens.css 참조)

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/theme.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import "./theme"`

- [ ] **Step 3: theme.js 구현**

`frontend/src/lib/theme.js`:

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npm test`
Expected: PASS — format 18 + theme 7 = 25 tests passed

- [ ] **Step 5: tokens.css 작성**

`frontend/src/styles/tokens.css`:

```css
/* 라이트 팔레트를 전부 여기에 정의한다.
   다크 블록에서는 달라지는 토큰만 재정의한다. */
:root {
  color-scheme: light;

  --surface: #FFFFFF;
  --surface-sunken: #F2F1F6;
  --surface-raised: #FFFFFF;

  --text: #1A1025;
  --text-muted: #5A4D7A;
  --text-subtle: #9B90B8;
  --text-on-brand: #FFFFFF;

  --border: #E8E4F4;
  --border-strong: #D8D3E6;

  --brand: #6B4FE8;
  --brand-strong: #5038C4;
  --brand-light: #8B72F0;
  --brand-soft: #F0ECFF;
  --brand-gradient: linear-gradient(135deg, #8B72F0 0%, #6B4FE8 48%, #5038C4 100%);

  --danger: #E53E3E;   --danger-soft: #FFF0F0;
  --success: #22C55E;  --success-soft: #F0FFF4;
  --warning: #EA580C;  --warning-soft: #FFF7ED;
  --today: #0066CC;    --today-soft: #E0F2FE;
  --track: #EDE9FF;

  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 28px;
  --radius-pill: 999px;

  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  --shadow-card: 0 1px 8px rgba(107, 79, 232, .07);
  --shadow-hover: 0 16px 44px rgba(107, 79, 232, .16);
  --shadow-brand: 0 10px 28px rgba(107, 79, 232, .30);
  --shadow-pop: 0 8px 32px rgba(26, 16, 37, .12);

  --font-sans: 'Noto Sans KR', system-ui, -apple-system, sans-serif;
  --font-num: 'DM Sans', 'Noto Sans KR', system-ui, sans-serif;

  --ease: cubic-bezier(.4, 0, .2, 1);
}

/* 시스템이 다크이고 사용자가 라이트를 고르지 않았을 때 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #171325;
    --surface-sunken: #100D1A;
    --surface-raised: #1F1A30;
    --text: #F3F0FA;
    --text-muted: #B5AACB;
    --text-subtle: #7D7391;
    --border: #2C2440;
    --border-strong: #3A3154;
    --brand: #8B72F0;
    --brand-strong: #A692F5;
    --brand-soft: #241D3B;
    --danger: #FF6B6B;   --danger-soft: #2E1A1A;
    --success: #4ADE80;  --success-soft: #16281C;
    --warning: #FB923C;  --warning-soft: #2C1D10;
    --today: #5AB0FF;    --today-soft: #12283A;
    --track: #2A2340;
    --shadow-card: 0 1px 8px rgba(0, 0, 0, .40);
    --shadow-hover: 0 16px 44px rgba(0, 0, 0, .55);
    --shadow-pop: 0 8px 32px rgba(0, 0, 0, .50);
  }
}

/* 사용자가 명시적으로 다크를 고른 경우. 시스템이 라이트여도 이긴다. */
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #171325;
  --surface-sunken: #100D1A;
  --surface-raised: #1F1A30;
  --text: #F3F0FA;
  --text-muted: #B5AACB;
  --text-subtle: #7D7391;
  --border: #2C2440;
  --border-strong: #3A3154;
  --brand: #8B72F0;
  --brand-strong: #A692F5;
  --brand-soft: #241D3B;
  --danger: #FF6B6B;   --danger-soft: #2E1A1A;
  --success: #4ADE80;  --success-soft: #16281C;
  --warning: #FB923C;  --warning-soft: #2C1D10;
  --today: #5AB0FF;    --today-soft: #12283A;
  --track: #2A2340;
  --shadow-card: 0 1px 8px rgba(0, 0, 0, .40);
  --shadow-hover: 0 16px 44px rgba(0, 0, 0, .55);
  --shadow-pop: 0 8px 32px rgba(0, 0, 0, .50);
}
```

- [ ] **Step 6: base.css 작성**

`frontend/src/styles/base.css`:

```css
*, *::before, *::after { box-sizing: border-box; }

html, body, #root { margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--surface-sunken);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  transition: background .2s var(--ease), color .2s var(--ease);
}

h1, h2, h3, h4, p, figure { margin: 0; }
button, input, textarea, select { font: inherit; color: inherit; }
img, svg { max-width: 100%; }

/* 랜딩과 같은 타이포 위계 */
.t-display { font-size: clamp(28px, 4vw, 38px); font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
.t-title   { font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
.t-section { font-size: 15px; font-weight: 700; }
.t-body    { font-size: 14px; font-weight: 400; line-height: 1.7; color: var(--text-muted); }
.t-caption { font-size: 12px; font-weight: 400; color: var(--text-subtle); }
.t-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--text-subtle); }
.t-num     { font-family: var(--font-num); font-weight: 700; }

:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: var(--radius-xs);
}

@keyframes lbpulse { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes lbspin  { to { transform: rotate(360deg) } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```

- [ ] **Step 7: useTheme 훅 작성**

`frontend/src/lib/useTheme.js`:

```js
import { useState, useEffect } from 'react';
import { readStoredTheme, writeStoredTheme, applyTheme } from './theme';

export function useTheme() {
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const setTheme = (next) => {
    writeStoredTheme(next);
    setThemeState(next);
  };

  return { theme, setTheme };
}
```

- [ ] **Step 8: 커밋**

```bash
cd frontend
git add src/styles/tokens.css src/styles/base.css src/lib/theme.js src/lib/theme.test.js src/lib/useTheme.js
git commit -m "feat(styles): 의미 기반 디자인 토큰과 테마 전환

- tokens.css: 라이트 팔레트를 :root에 전부 정의, 다크는 미디어쿼리와
  [data-theme=dark] 두 곳에 작성해 양방향 토글이 동작하게 함
- base.css: reset, 타이포 스케일, focus-visible, reduced-motion
- theme.js: localStorage 접근 실패 시 system 폴백(테스트 포함)"
```

---

## Task 3: 아이콘 세트 20종

이모지를 대체한다. 랜딩의 `DocIcon`/`CheckIcon`/`CalIcon`(`LittleBoss.jsx:151-160`) 스타일을 기준으로 한다.

**Files:**
- Create: `frontend/src/icons/index.jsx`
- Create: `frontend/src/icons/index.test.jsx`

**Interfaces:**
- Consumes: 없음
- Produces: 20개 named export. 모두 `({ size = 20, ...rest }) => JSX` 시그니처. `stroke="currentColor"`이므로 색은 부모 CSS의 `color`가 결정한다.
  `Home, Upload, Folder, FolderOpen, Calendar, ListCheck, CheckCircle, User, Search, Bell, Trash, Pencil, Close, ChevronDown, ChevronRight, ArrowLeft, FileText, Inbox, Lock, Sparkle`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/icons/index.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from './index';

const NAMES = [
  'Home', 'Upload', 'Folder', 'FolderOpen', 'Calendar', 'ListCheck', 'CheckCircle',
  'User', 'Search', 'Bell', 'Trash', 'Pencil', 'Close', 'ChevronDown',
  'ChevronRight', 'ArrowLeft', 'FileText', 'Inbox', 'Lock', 'Sparkle',
];

describe('아이콘 세트', () => {
  it('20종이 모두 export되어 있다', () => {
    NAMES.forEach((n) => expect(typeof icons[n]).toBe('function'));
    expect(NAMES).toHaveLength(20);
  });

  it('모든 아이콘이 svg를 렌더하고 currentColor를 쓴다', () => {
    NAMES.forEach((n) => {
      const html = renderToStaticMarkup(icons[n]({}));
      expect(html).toContain('<svg');
      expect(html).toContain('currentColor');
      expect(html).toContain('viewBox="0 0 24 24"');
    });
  });

  it('size prop이 width/height에 반영된다', () => {
    const html = renderToStaticMarkup(icons.Home({ size: 32 }));
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import "./index"`

- [ ] **Step 3: 아이콘 구현**

`frontend/src/icons/index.jsx`:

```jsx
// 랜딩과 같은 라인 스타일: 24 그리드, stroke 1.8, 둥근 끝처리.
// 색은 currentColor로 상속받는다. 컴포넌트에서 색을 지정하지 않는다.

const Svg = ({ size = 20, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const Home = (p) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></Svg>
);
export const Upload = (p) => (
  <Svg {...p}><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>
);
export const Folder = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
export const FolderOpen = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v1.5H3z" /><path d="M3 11h18l-2 8a1.5 1.5 0 0 1-1.5 1H5a2 2 0 0 1-2-2z" /></Svg>
);
export const Calendar = (p) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M16 3v4M8 3v4M3 10h18" /></Svg>
);
export const ListCheck = (p) => (
  <Svg {...p}><path d="M4 7.5 6 9.5l3-3.5" /><path d="M4 16.5 6 18.5l3-3.5" /><path d="M12.5 8h7.5M12.5 17h7.5" /></Svg>
);
export const CheckCircle = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Svg>
);
export const User = (p) => (
  <Svg {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.7 4-5.6 7.5-5.6s6.3 1.9 7.5 5.6" /></Svg>
);
export const Search = (p) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);
export const Bell = (p) => (
  <Svg {...p}><path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17S18 15 18 9" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></Svg>
);
export const Trash = (p) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2A1.5 1.5 0 0 0 16.6 19L17.5 7" /></Svg>
);
export const Pencil = (p) => (
  <Svg {...p}><path d="M15.5 4.5 19.5 8.5 8 20H4v-4z" /><path d="m13.5 6.5 4 4" /></Svg>
);
export const Close = (p) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);
export const ChevronDown = (p) => (
  <Svg {...p}><path d="m6 9.5 6 6 6-6" /></Svg>
);
export const ChevronRight = (p) => (
  <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>
);
export const ArrowLeft = (p) => (
  <Svg {...p}><path d="M20 12H4" /><path d="m9.5 6.5-5.5 5.5 5.5 5.5" /></Svg>
);
export const FileText = (p) => (
  <Svg {...p}><path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v5.5H19" /><path d="M8.5 13h7M8.5 16.5h4.5" /></Svg>
);
export const Inbox = (p) => (
  <Svg {...p}><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M4.5 6.5 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.5-6.5A2 2 0 0 0 17.6 5H6.4a2 2 0 0 0-1.9 1.5z" /></Svg>
);
export const Lock = (p) => (
  <Svg {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Svg>
);
export const Sparkle = (p) => (
  <Svg {...p}><path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.1 10.2 12.6 4.5 10.8 10.2 9z" /><path d="M18.5 16.5 19.2 18.6 21.3 19.3 19.2 20 18.5 22.1 17.8 20 15.7 19.3 17.8 18.6z" /></Svg>
);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npm test`
Expected: PASS — 28 tests passed

- [ ] **Step 5: 커밋**

```bash
cd frontend
git add src/icons/index.jsx src/icons/index.test.jsx
git commit -m "feat(icons): 이모지를 대체할 자체 라인 아이콘 20종

랜딩의 라인 스타일(24 그리드, stroke 1.8, 둥근 끝)을 기준으로 통일.
stroke=currentColor라 색은 부모 CSS가 결정한다."
```

---

## Task 4: 공통 컴포넌트와 components.css

**Files:**
- Create: `frontend/src/styles/components.css`
- Create: `frontend/src/components/Button.jsx` `Card.jsx` `Chip.jsx` `Field.jsx` `Toggle.jsx` `ProgressBar.jsx`
- Create: `frontend/src/components/EmptyState.jsx` `Skeleton.jsx` `Toast.jsx` `ConfirmDialog.jsx`
- Create: `frontend/src/lib/useToast.js` `frontend/src/lib/useIsMobile.js`

**Interfaces:**
- Consumes: `src/icons/index.jsx`, `src/styles/tokens.css`
- Produces:
  - `<Button variant="primary"|"outline"|"ghost"|"danger" size="sm"|"md" icon={Icon} onClick disabled>텍스트</Button>`
  - `<Card title? actions?>children</Card>`
  - `<Chip tone="brand"|"danger"|"success"|"warning"|"neutral">텍스트</Chip>`
  - `<Field label hint? error? disabled? type? value onChange placeholder />`
  - `<Toggle checked onChange label? />`
  - `<ProgressBar value total />`
  - `<EmptyState icon={Icon} title desc? actionLabel? onAction? />`
  - `<Skeleton rows={3} />`
  - `<Toast msg show />`
  - `<ConfirmDialog open title desc confirmLabel cancelLabel tone="danger"|"brand" onConfirm onCancel busy? />`
  - `useToast() -> { msg, show, toast }`
  - `useIsMobile(bp = 768) -> boolean`

- [ ] **Step 1: components.css 작성**

`frontend/src/styles/components.css`:

```css
/* ── 버튼 ── */
.btn {
  display: inline-flex; align-items: center; gap: var(--space-2);
  border: none; border-radius: var(--radius-sm);
  font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background .2s var(--ease), transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease);
}
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-md { padding: 10px 20px; font-size: 13px; }
.btn-sm { padding: 7px 14px; font-size: 12px; }

.btn-primary { background: var(--brand); color: var(--text-on-brand); box-shadow: var(--shadow-brand); }
.btn-primary:hover:not(:disabled) { background: var(--brand-strong); transform: translateY(-1px); }

.btn-outline { background: var(--surface); color: var(--text-muted); border: 1.5px solid var(--border); }
.btn-outline:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); transform: translateY(-1px); }

.btn-ghost { background: transparent; color: var(--text-muted); }
.btn-ghost:hover:not(:disabled) { background: var(--brand-soft); color: var(--brand); }

/* 되돌릴 수 없는 동작 전용. 브랜드색을 쓰지 않는다. */
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { filter: brightness(.92); transform: translateY(-1px); }

/* ── 카드 ── */
.card {
  background: var(--surface-raised); border-radius: var(--radius-md);
  padding: var(--space-5); box-shadow: var(--shadow-card);
  border: 1px solid var(--border);
}
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4); }

/* ── 칩 ── */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 700;
}
.chip-brand   { background: var(--brand-soft);   color: var(--brand); }
.chip-danger  { background: var(--danger-soft);  color: var(--danger); }
.chip-success { background: var(--success-soft); color: var(--success); }
.chip-warning { background: var(--warning-soft); color: var(--warning); }
.chip-neutral { background: var(--surface-sunken); color: var(--text-subtle); }

/* ── 입력 ── */
.field { margin-bottom: var(--space-4); }
.field-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
.field-input {
  width: 100%; padding: 12px 14px; font-size: 14px;
  background: var(--surface); color: var(--text);
  border: 1.5px solid var(--border); border-radius: var(--radius-sm);
  outline: none; transition: border-color .2s var(--ease);
}
.field-input:focus { border-color: var(--brand); }
.field-input:disabled { background: var(--surface-sunken); color: var(--text-subtle); cursor: not-allowed; }
.field-hint  { margin-top: 6px; font-size: 12px; color: var(--text-subtle); }
.field-error { margin-top: 6px; font-size: 12px; color: var(--danger); }

/* ── 토글 ── */
.toggle { width: 44px; height: 24px; border-radius: var(--radius-pill); border: none;
  background: var(--border-strong); cursor: pointer; position: relative; transition: background .2s var(--ease); }
.toggle[aria-checked="true"] { background: var(--brand); }
.toggle-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform .2s var(--ease); }
.toggle[aria-checked="true"] .toggle-knob { transform: translateX(20px); }

/* ── 진행바 ── */
.progress { height: 7px; border-radius: 4px; background: var(--track); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; background: var(--brand); transition: width .3s var(--ease); }

/* ── 빈 상태 ── */
.empty { text-align: center; padding: var(--space-7) var(--space-5); }
.empty-icon { color: var(--text-subtle); margin-bottom: var(--space-3); }
.empty-title { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.empty-desc  { font-size: 13px; color: var(--text-subtle); margin-bottom: var(--space-4); }

/* ── 스켈레톤 ── */
.skeleton-row { height: 14px; border-radius: var(--radius-xs); background: var(--track);
  animation: lbpulse 1.4s ease-in-out infinite; margin-bottom: var(--space-3); }

/* ── 토스트 ── */
.toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
  background: var(--text); color: var(--surface); padding: 12px 22px;
  border-radius: var(--radius-sm); font-size: 13px; font-weight: 600;
  box-shadow: var(--shadow-pop); z-index: 200;
  opacity: 0; pointer-events: none; transition: opacity .25s var(--ease), transform .25s var(--ease); }
.toast-show { opacity: 1; transform: translateX(-50%) translateY(-4px); }

/* ── 확인 모달 ── */
.dialog-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 300;
  display: flex; align-items: center; justify-content: center; }
.dialog { background: var(--surface-raised); border-radius: var(--radius-lg);
  padding: var(--space-6); width: min(420px, calc(100vw - 32px)); box-shadow: var(--shadow-pop); }
.dialog-title { font-size: 17px; font-weight: 800; margin-bottom: var(--space-2); }
.dialog-desc { font-size: 13.5px; color: var(--text-muted); line-height: 1.7; margin-bottom: var(--space-5); }
.dialog-actions { display: flex; gap: var(--space-2); justify-content: flex-end; }

/* ── 스피너 ── */
.spinner { width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--track); border-top-color: var(--brand);
  animation: lbspin .7s linear infinite; display: inline-block; }
```

- [ ] **Step 2: 원자 컴포넌트 작성**

`frontend/src/components/Button.jsx`:

```jsx
export default function Button({ variant = 'primary', size = 'md', icon: Icon, children, ...rest }) {
  return (
    <button className={`btn btn-${variant} btn-${size}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
```

`frontend/src/components/Card.jsx`:

```jsx
export default function Card({ title, actions, className = '', children, ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {title && <div className="t-section">{title}</div>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
```

`frontend/src/components/Chip.jsx`:

```jsx
export default function Chip({ tone = 'brand', children, ...rest }) {
  return <span className={`chip chip-${tone}`} {...rest}>{children}</span>;
}
```

`frontend/src/components/Field.jsx`:

```jsx
export default function Field({ label, hint, error, id, ...rest }) {
  const inputId = id || `f-${label}`;
  return (
    <div className="field">
      {label && <label className="field-label" htmlFor={inputId}>{label}</label>}
      <input id={inputId} className="field-input" {...rest} />
      {hint && !error && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
```

`frontend/src/components/Toggle.jsx`:

```jsx
export default function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}
```

`frontend/src/components/ProgressBar.jsx`:

```jsx
export default function ProgressBar({ value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 3: 합성 컴포넌트 작성**

`frontend/src/components/EmptyState.jsx`:

```jsx
import { Inbox } from '../icons';
import Button from './Button';

// 완료된 문서 화면에서 검증된 패턴. 모든 빈 상태는 이걸 쓴다.
export default function EmptyState({ icon: Icon = Inbox, title, desc, actionLabel, onAction }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={40} /></div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}
```

`frontend/src/components/Skeleton.jsx`:

```jsx
export default function Skeleton({ rows = 3 }) {
  return (
    <div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}
```

`frontend/src/components/Toast.jsx`:

```jsx
export default function Toast({ msg, show }) {
  return <div className={`toast ${show ? 'toast-show' : ''}`} role="status">{msg}</div>;
}
```

`frontend/src/components/ConfirmDialog.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import Button from './Button';

// 되돌릴 수 없는 동작의 단일 확인 경로.
// 기본 포커스는 취소에 둔다 — Enter를 눌렀을 때 삭제되지 않게.
export default function ConfirmDialog({
  open, title, desc, confirmLabel = '삭제', cancelLabel = '취소',
  tone = 'danger', busy = false, onConfirm, onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (open && cancelRef.current) cancelRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        {desc && <div className="dialog-desc">{desc}</div>}
        <div className="dialog-actions">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? '처리 중...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

> `Button`이 `ref`를 받도록 `forwardRef`로 감싼다. `Button.jsx`를 다음으로 교체한다:

```jsx
import { forwardRef } from 'react';

const Button = forwardRef(function Button({ variant = 'primary', size = 'md', icon: Icon, children, ...rest }, ref) {
  return (
    <button ref={ref} className={`btn btn-${variant} btn-${size}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
});

export default Button;
```

- [ ] **Step 4: 훅 분리**

`frontend/src/lib/useToast.js` — `LittleBoss.jsx:125-135`의 `useToast`를 그대로 옮긴다. 단 이모지를 쓰는 호출부는 각 화면 이관 시 문구에서 이모지를 제거한다.

```js
import { useState, useRef } from 'react';

export function useToast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const toast = (m) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  };

  return { msg, show, toast };
}
```

`frontend/src/lib/useIsMobile.js` — `LittleBoss.jsx:84-92`를 옮긴다.

```js
import { useState, useEffect } from 'react';

export function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < bp : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < bp);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bp]);

  return isMobile;
}
```

- [ ] **Step 5: 테스트가 여전히 통과하는지 확인**

Run: `cd frontend && npm test`
Expected: PASS — 28 tests passed (새 테스트 없음, 회귀 없음 확인)

- [ ] **Step 6: 커밋**

```bash
cd frontend
git add src/styles/components.css src/components src/lib/useToast.js src/lib/useIsMobile.js
git commit -m "feat(components): 공통 컴포넌트와 components.css

- Button/Card/Chip/Field/Toggle/ProgressBar 원자 컴포넌트
- EmptyState는 완료된 문서 화면 패턴을 표준화한 것
- ConfirmDialog는 파괴적 동작의 단일 경로. 확인 버튼은 danger,
  기본 포커스는 취소에 둬 Enter로 삭제되지 않게 함"
```

---

## Task 5: 앱 셸과 엔트리 이관

여기서 앱이 새 구조로 부팅된다. 첫 번째 눈으로 확인 가능한 마일스톤이다.

**Files:**
- Create: `frontend/src/components/AppShell.jsx` `Header.jsx` `Sidebar.jsx`
- Create: `frontend/src/App.jsx` `frontend/src/main.jsx`
- Create: `frontend/src/lib/auth.js` `frontend/src/lib/useDocuments.js`
- Modify: `frontend/app.html`
- Delete: `frontend/main.jsx`

**Interfaces:**
- Consumes: Task 2~4 전부
- Produces:
  - `<AppShell sub onNavTo sidebarOpen setSidebarOpen onLogout>children</AppShell>`
  - `getUser() -> { name, email, id }`
  - `isLoggedIn() -> boolean`
  - `clearSession() -> void`
  - `getCalendarToken() -> string|null`, `clearCalendarToken() -> void`
  - `useDocuments() -> { docs, loading, error, reload }` (기존 `api.js`에서 이동)

- [ ] **Step 1: auth.js 작성**

`frontend/src/lib/auth.js`:

```js
// localStorage 직접 접근을 이 파일로 모은다.
// 화면 코드는 키 이름을 알 필요가 없다.
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 차단 환경 */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* 차단 환경 */ } };

export function getUser() {
  return {
    id: read('user_id') || '',
    name: read('user_name') || '사용자',
    email: read('user_email') || '',
    affiliation: read('user_affiliation') || '',
  };
}

export function isLoggedIn() {
  return !!read('user_id');
}

// 이메일 가입자는 user_id가 이메일(@ 포함), 구글 로그인은 숫자 sub
export function isEmailUser() {
  return (read('user_id') || '').includes('@');
}

export function saveSession({ user_id, email, name }) {
  write('user_id', user_id);
  write('user_email', email || '');
  write('user_name', name || '');
}

export function clearSession() {
  try { localStorage.clear(); } catch { /* 차단 환경 */ }
}

// ── Google 캘린더 토큰 (1시간 만료) ──
// 만료돼도 로그인 세션은 건드리지 않는다. 캘린더 연결만 끊는다.
export function getCalendarToken() { return read('user_token'); }
export function saveCalendarToken(t) { write('user_token', t); }
export function clearCalendarToken() { drop('user_token'); }
```

- [ ] **Step 2: useDocuments 이동**

`frontend/src/lib/api.js`에 있는 `useDocuments` 훅(현 `api.js:174` 이후)을 `frontend/src/lib/useDocuments.js`로 잘라내 옮기고, `api.js`에서는 해당 export를 제거한다. 새 파일은 `./api`에서 필요한 함수를 import한다.

- [ ] **Step 3: Sidebar 작성**

`frontend/src/components/Sidebar.jsx` — `LittleBoss.jsx:745-773`를 이관하되 이모지를 아이콘 컴포넌트로 바꾼다.

```jsx
import { useState } from 'react';
import { Home, Upload, Folder, Calendar, ListCheck, CheckCircle, User, ChevronDown } from '../icons';

const SUB_ITEMS = [
  ['sub-schedule', Calendar, '일정 관리'],
  ['sub-ongoing', ListCheck, '진행 중인 문서'],
  ['sub-completed', CheckCircle, '완료된 문서'],
];

export default function Sidebar({ currentSub, onNavTo, sidebarOpen }) {
  const [subOpen, setSubOpen] = useState(
    SUB_ITEMS.some(([id]) => id === currentSub)
  );
  const isDocsSub = SUB_ITEMS.some(([id]) => id === currentSub);

  const NavItem = ({ id, icon: Icon, label }) => {
    const active = currentSub === id;
    return (
      <button className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={() => onNavTo(id)}>
        <Icon size={17} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <NavItem id="sub-home" icon={Home} label="대시보드" />
      <NavItem id="sub-upload" icon={Upload} label="문서 업로드" />
      <button
        className={`nav-item ${isDocsSub ? 'nav-item-parent' : ''}`}
        onClick={() => setSubOpen((p) => !p)}
        aria-expanded={subOpen}
      >
        <Folder size={17} />
        <span>내 문서 관리</span>
        <ChevronDown size={16} className={`nav-caret ${subOpen ? 'nav-caret-open' : ''}`} />
      </button>
      {subOpen && (
        <div className="nav-sub">
          {SUB_ITEMS.map(([id, Icon, label]) => (
            <button
              key={id}
              className={`nav-item nav-item-sub ${currentSub === id ? 'nav-item-active' : ''}`}
              onClick={() => onNavTo(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
```

`components.css`에 추가:

```css
.sidebar {
  width: 200px; flex-shrink: 0; position: fixed; top: 58px; bottom: 0; z-index: 45;
  background: var(--surface); border-right: 1px solid var(--border);
  padding: var(--space-5) var(--space-3); overflow-y: auto;
  transform: translateX(-200px); opacity: 0; pointer-events: none;
  transition: transform .35s var(--ease), opacity .35s var(--ease);
}
.sidebar-open { transform: translateX(0); opacity: 1; pointer-events: auto; }
.nav-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 9px 12px; margin-bottom: 2px;
  background: transparent; border: none; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 500; color: var(--text-muted);
  cursor: pointer; text-align: left; transition: background .15s var(--ease), color .15s var(--ease);
}
.nav-item:hover { background: var(--brand-soft); color: var(--brand); }
.nav-item-active { background: var(--brand); color: var(--text-on-brand); font-weight: 600; }
.nav-item-active:hover { background: var(--brand); color: var(--text-on-brand); }
.nav-item-parent { color: var(--brand); }
.nav-item-sub { font-size: 12.5px; padding-left: 16px; }
.nav-sub { padding-left: 16px; }
.nav-caret { margin-left: auto; transition: transform .25s var(--ease); }
.nav-caret-open { transform: rotate(180deg); }
```

- [ ] **Step 4: Header 작성**

`frontend/src/components/Header.jsx` — `LittleBoss.jsx:546-743`를 이관한다. 알림 드롭다운 로직(`LittleBoss.jsx:587-623`)은 그대로 가져오되 알림 아이템의 `icon: "📄"` / `"✅"` / `"🔔"`을 각각 `FileText` / `CheckCircle` / `Bell` 컴포넌트 참조로 바꾼다. 헤더 높이 58px, `position: fixed`, 좌측에 햄버거(모바일)와 로고, 우측에 알림 벨과 프로필 드롭다운.

**변경점:** 프로필 드롭다운에만 "내 정보" 진입 경로를 둔다(사이드바의 `내 정보` 항목은 Task 11에서 제거).

- [ ] **Step 5: AppShell 작성**

`frontend/src/components/AppShell.jsx`:

```jsx
import Header from './Header';
import Sidebar from './Sidebar';
import { useIsMobile } from '../lib/useIsMobile';

export default function AppShell({ sub, onNavTo, sidebarOpen, setSidebarOpen, onLogout, children }) {
  const isMobile = useIsMobile();
  return (
    <div className="app-root">
      <Header
        onLogout={onLogout}
        onNavTo={onNavTo}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />
      <div className="app-body">
        <Sidebar currentSub={sub} onNavTo={onNavTo} sidebarOpen={sidebarOpen} />
        {isMobile && sidebarOpen && (
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
        )}
        <main className={`app-main ${sidebarOpen && !isMobile ? 'app-main-pushed' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
```

`components.css`에 추가:

```css
.app-root { min-height: 100vh; background: var(--surface-sunken); }
.app-body { display: flex; padding-top: 58px; min-height: calc(100vh - 58px); }
.app-main { flex: 1; padding: var(--space-6); transition: padding-left .35s var(--ease); min-width: 0; }
.app-main-pushed { padding-left: calc(200px + var(--space-6)); }
.sidebar-scrim { position: fixed; top: 58px; inset-inline: 0; bottom: 0; background: rgba(0,0,0,.4); z-index: 40; }
@media (max-width: 768px) {
  .app-main { padding: var(--space-4); }
  .app-main-pushed { padding-left: var(--space-4); }
}
```

- [ ] **Step 6: App.jsx와 main.jsx 작성**

`frontend/src/App.jsx` — `LittleBoss.jsx:2386-2457`의 라우팅 상태·히스토리 로직을 그대로 이관한다. 라우터는 도입하지 않는다.

```jsx
import { useState, useEffect } from 'react';
import AppShell from './components/AppShell';
import Toast from './components/Toast';
import { useToast } from './lib/useToast';
import { useTheme } from './lib/useTheme';
import { isLoggedIn, clearSession } from './lib/auth';

import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import DashboardPage from './pages/DashboardPage';
import UploadPage from './pages/UploadPage';
import SchedulePage from './pages/SchedulePage';
import OngoingPage from './pages/OngoingPage';
import CompletedPage from './pages/CompletedPage';
import ScheduleDetailPage from './pages/ScheduleDetailPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import ProfilePage from './pages/profile/ProfilePage';

const TITLES = {
  'sub-home': '대시보드', 'sub-upload': '문서 업로드', 'sub-schedule': '일정 관리',
  'sub-ongoing': '진행 중인 문서', 'sub-completed': '완료된 문서', 'sub-profile': '내 정보',
  'schedule-detail': '일정 상세', 'doc-detail': '문서 상세',
};

export default function App() {
  useTheme(); // <html data-theme> 부착
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(params.get('page') || (isLoggedIn() ? 'app' : 'login'));
  const [sub, setSub] = useState(params.get('sub') || 'sub-home');
  const [prevSub, setPrevSub] = useState('sub-home');
  const [detailDay, setDetailDay] = useState(null);
  const [detailTitle, setDetailTitle] = useState(null);
  const [docData, setDocData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 768
  );
  const { msg, show, toast } = useToast();

  const navTo = (s, detail, data) => {
    if (s === 'schedule-detail' || s === 'doc-detail') setPrevSub(sub);
    setSub(s);
    if (detail) {
      if (typeof detail === 'number') setDetailDay(detail);
      else setDetailTitle(detail);
    }
    if (data) setDocData(data);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleLogin = (m) => { setPage('app'); setSub('sub-home'); toast(m); };
  const handleLogout = () => {
    clearSession();
    window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: null }));
    setPage('login');
    toast('로그아웃됐어요');
  };

  useEffect(() => {
    window.history.pushState({ sub, detailDay, detailTitle, docData }, null, '');
    const onPop = (e) => {
      if (!e.state) return;
      setSub(e.state.sub || 'sub-home');
      if (e.state.detailDay) setDetailDay(e.state.detailDay);
      if (e.state.detailTitle) setDetailTitle(e.state.detailTitle);
      if (e.state.docData) setDocData(e.state.docData);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [sub, detailDay, detailTitle, docData]);

  if (page === 'signup') return <><SignupPage onLogin={handleLogin} goLogin={() => setPage('login')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'login') return <><LoginPage onLogin={handleLogin} goSignup={() => setPage('signup')} goForgotPassword={() => setPage('forgot-password')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'forgot-password') return <><ForgotPasswordPage toast={toast} goLogin={() => setPage('login')} /><Toast msg={msg} show={show} /></>;

  const PAGES = {
    'sub-home': <DashboardPage onNavTo={navTo} />,
    'sub-upload': <UploadPage onNavTo={navTo} />,
    'sub-schedule': <SchedulePage onNavTo={navTo} />,
    'sub-ongoing': <OngoingPage onNavTo={navTo} toast={toast} />,
    'sub-completed': <CompletedPage onNavTo={navTo} toast={toast} />,
    'sub-profile': <ProfilePage toast={toast} onLogout={handleLogout} />,
    'schedule-detail': <ScheduleDetailPage day={detailDay} title={detailTitle} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
    'doc-detail': <DocumentDetailPage data={docData} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
  };

  return (
    <>
      <AppShell sub={sub} onNavTo={navTo} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onLogout={handleLogout}>
        <h1 className="page-title">{TITLES[sub]}</h1>
        {PAGES[sub]}
      </AppShell>
      <Toast msg={msg} show={show} />
    </>
  );
}
```

`frontend/src/main.jsx`:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
```

```bash
cd frontend && git rm main.jsx
```

- [ ] **Step 7: app.html 정리**

`frontend/app.html` 전체를 다음으로 교체한다. 뷰포트 고정 해제, 타이틀 교정, Figma 스크립트 제거, 테마 깜빡임 방지 부트 스크립트 추가.

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LittleBoss — AI 행정 비서</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
    <script>
      // 첫 페인트 전에 테마를 붙여 흰 화면 깜빡임을 막는다.
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 8: 임시 스텁으로 빌드 통과시키기**

Task 6~11에서 만들 페이지 파일들이 아직 없으므로, 각 경로에 최소 스텁을 만들어 앱이 뜨게 한다. 스텁은 해당 태스크에서 실제 구현으로 교체된다.

각 파일에 다음 형태로 작성한다(파일명에 맞게 컴포넌트 이름만 바꾼다):

```jsx
export default function DashboardPage() {
  return <div className="card">준비 중</div>;
}
```

대상: `pages/auth/LoginPage.jsx` `SignupPage.jsx` `ForgotPasswordPage.jsx`, `pages/DashboardPage.jsx` `UploadPage.jsx` `SchedulePage.jsx` `OngoingPage.jsx` `CompletedPage.jsx` `ScheduleDetailPage.jsx` `DocumentDetailPage.jsx`, `pages/profile/ProfilePage.jsx`

> 인증 스텁은 props를 받아야 앱이 로그인 화면에서 멈추지 않는다. `LoginPage`만 임시로 다음처럼 둔다:

```jsx
export default function LoginPage({ onLogin }) {
  return (
    <div className="card" style={{ margin: 40 }}>
      <button className="btn btn-primary btn-md" onClick={() => onLogin('임시 로그인')}>임시 로그인</button>
    </div>
  );
}
```

- [ ] **Step 9: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 앱이 에러 없이 뜬다
- 사이드바에 이모지가 아니라 선 아이콘이 보인다
- 사이드바 항목 호버 시 배경이 바뀐다(CSS 호버가 동작한다는 증거)
- 브라우저 개발자도구에서 `<html>`에 `data-theme`를 `dark`로 수동 설정하면 배경과 글자색이 반전된다
- 창을 400px 폭으로 줄여도 가로 스크롤이 생기지 않는다

- [ ] **Step 10: 커밋**

```bash
cd frontend
git add src/ app.html
git rm --cached main.jsx 2>/dev/null || true
git commit -m "feat(shell): 앱 셸과 엔트리를 src 구조로 이관

- AppShell/Header/Sidebar 신설, 사이드바 이모지를 아이콘으로 교체
- App.jsx가 기존 page/sub 상태와 history 로직을 그대로 승계(라우터 미도입)
- app.html: 뷰포트 고정 해제, 타이틀 교정, Figma capture 스크립트 제거,
  첫 페인트 전 테마 부트 스크립트 추가
- 나머지 화면은 스텁. 후속 태스크에서 교체"
```

---

## Task 6: 인증 화면

**Files:**
- Create: `frontend/src/pages/auth/AuthLayout.jsx` `LoginPage.jsx` `SignupPage.jsx` `ForgotPasswordPage.jsx`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `Field`, `Button`, `auth.js`, `api.js`
- Produces: 각 페이지 컴포넌트. `LoginPage({ onLogin, goSignup, goForgotPassword, toast })` 등 `App.jsx`가 넘기는 props 시그니처를 지킨다.

- [ ] **Step 1: AuthLayout 이관**

`LittleBoss.jsx:179-255`를 옮긴다. 좌측 브랜드 패널은 `--brand-gradient`를 쓰고, 랜딩의 `FlowIllustration`(`LittleBoss.jsx:162-176`)과 `Feature` 항목은 아이콘 컴포넌트(`Calendar`, `ListCheck`, `Bell`)로 교체한다.

- [ ] **Step 2: LoginPage 이관 + 로그인 상태 유지 노출**

`LittleBoss.jsx:386-434`를 옮기되 다음을 추가한다. 로그인 버튼 아래, "비밀번호를 잊으셨나요?" 위:

```jsx
<div className="auth-persist">
  <CheckCircle size={15} />
  <span>로그인 상태가 유지됩니다. 다음 방문에는 바로 대시보드로 들어갑니다.</span>
</div>
```

```css
.auth-persist {
  display: flex; align-items: flex-start; gap: 8px;
  margin: var(--space-3) 0 var(--space-4);
  padding: 10px 12px; border-radius: var(--radius-sm);
  background: var(--brand-soft); color: var(--brand);
  font-size: 12px; line-height: 1.6;
}
```

`localStorage` 직접 호출을 `saveSession()`으로 바꾼다.

- [ ] **Step 3: SignupPage 이관 + 약관 체크박스 수정**

`LittleBoss.jsx:314-384`를 옮긴다. **약관 동의 부분(현 `LittleBoss.jsx:375-377`)은 `label`이 `input`을 감싸도록 바꾼다.** 현재는 감싸지 않아 문구를 눌러도 체크되지 않는다.

```jsx
<label className="terms-row">
  <input
    type="checkbox"
    checked={agreeTerms}
    onChange={(e) => setAgreeTerms(e.target.checked)}
  />
  <span>
    <a href="#" onClick={(e) => e.preventDefault()}>이용약관</a> 및{' '}
    <a href="#" onClick={(e) => e.preventDefault()}>개인정보 처리방침</a>에 동의합니다.
  </span>
</label>
```

```css
.terms-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 4px; margin-bottom: var(--space-4);
  font-size: 12.5px; color: var(--text-muted); line-height: 1.6;
  cursor: pointer; border-radius: var(--radius-xs);
}
.terms-row:hover { background: var(--surface-sunken); }
.terms-row input { accent-color: var(--brand); width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; cursor: pointer; }
.terms-row a { color: var(--brand); text-decoration: none; }
```

- [ ] **Step 4: ForgotPasswordPage 이관**

`LittleBoss.jsx:436-543`을 옮긴다. 3단계 흐름과 문구를 유지하되 토스트 문구의 이모지(`📩`, `✅`)를 제거한다.

- [ ] **Step 5: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 로그인 화면에서 **"이용약관 및 개인정보 처리방침에 동의합니다" 문구를 클릭하면 체크박스가 토글된다** (회원가입 화면)
- 로그인 화면에 "로그인 상태가 유지됩니다" 안내가 보인다
- 실제 계정으로 로그인이 되고, 새로고침해도 대시보드로 바로 들어간다
- 다크모드에서 브랜드 패널의 흰 글씨가 읽힌다

- [ ] **Step 6: 커밋**

```bash
cd frontend
git add src/pages/auth src/styles/components.css
git commit -m "feat(auth): 인증 화면 이관과 접근성 수정

- 약관 체크박스를 label이 input을 감싸도록 바꿔 문구 클릭이 동작
- 로그인 화면에 상태 유지 안내를 노출(이미 동작하던 기능을 보이게)
- localStorage 직접 접근을 auth.js로 일원화"
```

---

## Task 7: 대시보드 (A안 · 마감 중심)

**Files:**
- Create: `frontend/src/pages/DashboardPage.jsx`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `useDocuments`, `format.js`, `EmptyState`, `Card`, `Chip`, `ProgressBar`, `Button`, 아이콘
- Produces: `DashboardPage({ onNavTo })`

- [ ] **Step 1: 히어로 데이터 계산**

`LittleBoss.jsx:802-806`의 `urgentDoc` 계산을 그대로 쓴다. 표기만 `format.js`로 바꾼다.

```jsx
const hero = docs
  .filter((d) => d.status === 'done' && d.deadlineDate && !deadlineInfo(d.deadlineDate).isPast && !d.completed)
  .map((d) => ({ ...d, _days: deadlineInfo(d.deadlineDate).days ?? 99999 }))
  .sort((a, b) => a._days - b._days)[0] || null;
```

- [ ] **Step 2: 화면 구성**

통계 4칸과 캘린더는 **만들지 않는다**. 구성은 다음 순서다.

1. 인사말 (`greeting()` — `LittleBoss.jsx:38-44`를 `lib/format.js`로 옮겨 함께 export)
2. 히어로 카드 — 없으면 `EmptyState`
3. 다음 마감 3건 (좌) / 준비물 요약 (우)
4. 최근 분석된 문서

```jsx
{hero ? (
  <section className="hero">
    <div className="hero-left">
      <Chip tone={deadlineTone(hero.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
        {formatDeadlineWithLabel(hero.deadlineDesc, hero.deadlineDate)}
      </Chip>
      <h2 className="hero-title">{hero.title}</h2>
      <p className="hero-meta">{hero.deadlineDate}</p>
      <div className="hero-progress">
        <span className="t-caption">준비물 {doneCount} / {hero.total}</span>
        <ProgressBar value={doneCount} total={hero.total} />
      </div>
      <Button variant="primary" onClick={() => onNavTo('doc-detail', null, hero)}>
        체크리스트 열기
      </Button>
    </div>
  </section>
) : (
  <Card>
    <EmptyState
      icon={Calendar}
      title="아직 다가오는 마감이 없어요"
      desc="문서를 올리면 마감일과 준비 서류를 자동으로 정리해 드립니다."
      actionLabel="문서 업로드"
      onAction={() => onNavTo('sub-upload')}
    />
  </Card>
)}
```

```css
.hero {
  background: var(--brand-gradient); color: #fff;
  border-radius: var(--radius-lg); padding: var(--space-6);
  box-shadow: var(--shadow-brand); margin-bottom: var(--space-5);
}
.hero .chip { background: rgba(255,255,255,.2); color: #fff; }
.hero-title { font-size: 26px; font-weight: 800; letter-spacing: -.01em; margin: var(--space-3) 0 6px; }
.hero-meta { font-size: 13px; opacity: .85; margin-bottom: var(--space-5); }
.hero-progress { max-width: 360px; margin-bottom: var(--space-5); }
.hero-progress .progress { background: rgba(255,255,255,.25); }
.hero-progress .progress-fill { background: #fff; }
.hero .btn-primary { background: #fff; color: var(--brand); box-shadow: none; }
.hero .btn-primary:hover { background: rgba(255,255,255,.9); }
.hero .t-caption { color: rgba(255,255,255,.85); display: block; margin-bottom: 6px; }

.dash-cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--space-5); margin-bottom: var(--space-5); }
@media (max-width: 1024px) { .dash-cols { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: 다음 마감 3건 / 준비물 요약**

히어로 아래 2열. 히어로에 쓴 문서는 "다음 마감"에서 제외한다.

```jsx
const upcoming = docs
  .filter((d) => d.status === 'done' && d.deadlineDate && !deadlineInfo(d.deadlineDate).isPast && !d.completed)
  .filter((d) => !hero || d.doc_id !== hero.doc_id)
  .sort((a, b) => deadlineInfo(a.deadlineDate).days - deadlineInfo(b.deadlineDate).days);

// 미완료 체크 항목을 문서 구분 없이 펼친다
const todos = docs
  .filter((d) => d.status === 'done' && !d.completed)
  .flatMap((d) => d.checks.filter((c) => !c.done).map((c) => ({ label: c.l, doc: d })))
  .slice(0, 5);
```

```jsx
<div className="dash-cols">
  <Card title="다음 마감">
    {upcoming.length === 0 ? (
      <EmptyState icon={Calendar} title="다음 마감이 없어요" />
    ) : (
      <>
        {upcoming.slice(0, 3).map((d) => (
          <button key={d.doc_id} className="row-item" onClick={() => onNavTo('doc-detail', null, d)}>
            <Chip tone={deadlineTone(d.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
              {formatDeadline(d.deadlineDate)}
            </Chip>
            <span className="row-title">{d.title}</span>
            <span className="t-caption">
              미완료 {d.total - d.checks.filter((c) => c.done).length}건
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {upcoming.length > 3 && (
          <Button variant="ghost" size="sm" onClick={() => onNavTo('sub-schedule')}>
            일정 관리에서 전체 보기
          </Button>
        )}
      </>
    )}
  </Card>

  <Card title="준비물 요약">
    {todos.length === 0 ? (
      <EmptyState icon={CheckCircle} title="챙길 서류가 없어요" />
    ) : (
      todos.map((t, i) => (
        <button key={i} className="row-item" onClick={() => onNavTo('doc-detail', null, t.doc)}>
          <span className="todo-box" />
          <span className="row-title">{t.label}</span>
          <span className="t-caption">{t.doc.title}</span>
        </button>
      ))
    )}
  </Card>
</div>
```

```css
.row-item {
  display: flex; align-items: center; gap: var(--space-3); width: 100%;
  padding: 12px 8px; background: none; border: none;
  border-bottom: 1px solid var(--border); cursor: pointer; text-align: left;
  transition: background .15s var(--ease);
}
.row-item:last-of-type { border-bottom: none; }
.row-item:hover { background: var(--surface-sunken); }
.row-title { flex: 1; font-size: 13.5px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-box { width: 16px; height: 16px; flex-shrink: 0;
  border: 1.5px solid var(--brand); border-radius: var(--radius-xs); }
```

- [ ] **Step 4: 최근 분석된 문서**

`LittleBoss.jsx:997-1033`의 검색/필터 UI를 이관하되 `🔍` placeholder 텍스트를 지우고 입력 왼쪽에 `Search` 아이콘을 둔다. 0건일 때는 `EmptyState`를 쓴다 — 검색 결과가 없는 경우와 문서가 아예 없는 경우의 문구를 구분한다.

```jsx
{filtered.length === 0 && (
  recentDocs.length === 0 ? (
    <EmptyState
      icon={FileText}
      title="아직 분석된 문서가 없어요"
      desc="문서를 올리면 마감일과 준비물이 여기에 정리됩니다."
      actionLabel="문서 업로드"
      onAction={() => onNavTo('sub-upload')}
    />
  ) : (
    <EmptyState icon={Search} title="조건에 맞는 문서가 없어요" desc="검색어나 필터를 바꿔보세요." />
  )
)}
```

- [ ] **Step 5: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 마감이 있는 계정에서 히어로에 가장 급한 마감이 뜨고 D-day가 라벨과 함께 보인다
- 마감이 없는 계정(또는 문서 전체 삭제 상태)에서 히어로 자리에 빈 상태 안내가 뜬다
- **캘린더가 대시보드에 없다**
- **통계 4칸이 없다**
- 1024px 이하로 줄이면 2열이 1열로 접힌다
- 히어로에 뜬 문서가 "다음 마감" 목록에 중복으로 나타나지 않는다

- [ ] **Step 6: 커밋**

```bash
cd frontend
git add src/pages/DashboardPage.jsx src/styles/components.css src/lib/format.js
git commit -m "feat(dashboard): 마감 중심 A안으로 재구성

- 가장 급한 마감 1건을 히어로로, 없으면 EmptyState
- 캘린더를 일정 관리로 이관하고 통계 4칸 제거
- 0% 도넛 제거 — 빈 상태를 문구로 설명"
```

---

## Task 8: 문서 업로드와 일정 관리

**Files:**
- Create: `frontend/src/pages/UploadPage.jsx` `frontend/src/pages/SchedulePage.jsx`

**Interfaces:**
- Consumes: `useDocuments`, `format.js`, `EmptyState`, `Card`, `Chip`, `api.js`
- Produces: `UploadPage({ onNavTo })`, `SchedulePage({ onNavTo })`

- [ ] **Step 1: UploadPage 이관 + 빈 상태**

`LittleBoss.jsx:1035-1300`을 옮긴다. 업로드·폴링·캘린더 등록 로직은 그대로 유지한다. `📎` 등 이모지를 `Upload`/`FileText` 아이콘으로 바꾼다.

**핵심 변경:** 우측 "분석 완료 문서" 패널이 0건일 때 빈 흰 공간으로 남지 않게 한다.

```jsx
<Card title="분석 완료 문서">
  {completedFiles.length === 0 ? (
    <EmptyState
      icon={FileText}
      title="아직 분석된 문서가 없어요"
      desc="왼쪽에서 파일을 올리면 분석 결과가 여기에 쌓입니다."
    />
  ) : (
    completedFiles.map((f) => <FileRow key={f.id} file={f} onNavTo={onNavTo} />)
  )}
</Card>
```

- [ ] **Step 2: SchedulePage 이관**

`LittleBoss.jsx:1302-1417`을 옮긴다. 캘린더는 이제 이 화면이 단독으로 책임진다.

**핵심 변경 두 가지:**

1. 마감 일정 목록의 D-day 표기를 `formatDeadline`으로 바꾼다. `dday: dd.text` → `dday: formatDeadline(e.date)`. 색은 `deadlineTone(e.date)`로 정한다.
2. 캘린더 셀 배경은 **범례에 있는 색만** 쓴다. `ongoing`/`completed`/`incomplete`와 `today` 외의 배경을 칠하지 않는다. 현재 코드에도 그 외 색은 없지만, 이관하면서 `bgColorMap`에 없는 status가 들어오면 배경을 칠하지 않도록 명시한다:

```jsx
const bg = ev && BG_MAP[ev.status] ? BG_MAP[ev.status] : (isToday ? 'var(--today-soft)' : 'transparent');
```

> **주의:** 보고된 "13~15일 연보라 하이라이트"는 현재 소스와 배포 번들 어디에서도 재현되지 않았다. 스크린샷이 확보되기 전까지 추가 조치를 하지 않는다. 위 방어 코드가 원인 후보 하나(알 수 없는 status가 들어오는 경우)를 막는다.

- [ ] **Step 3: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 업로드 화면에서 신규 계정처럼 보이게 하려면 개발자도구로 우측 목록을 비우고, 빈 상태 안내가 뜨는지 본다
- 실제 파일을 하나 올려 분석이 끝나면 우측에 쌓인다
- 일정 관리의 마감 목록에서 과거 일정이 `84일 지남` 형태로 뜨고 **마이너스 부호가 없다**
- 캘린더 셀 배경이 범례의 세 색 + 오늘 색 외에는 칠해지지 않는다

- [ ] **Step 4: 커밋**

```bash
cd frontend
git add src/pages/UploadPage.jsx src/pages/SchedulePage.jsx
git commit -m "feat(upload,schedule): 업로드·일정 관리 이관

- 업로드 우측 패널의 0건 상태를 EmptyState로 처리
- 일정 관리가 캘린더를 단독 책임
- 마감 표기를 format.js로 통일하고, 범례에 없는 색은 칠하지 않도록 방어"
```

---

## Task 9: 진행 중인 문서와 완료된 문서

**Files:**
- Create: `frontend/src/pages/OngoingPage.jsx` `frontend/src/pages/CompletedPage.jsx`

**Interfaces:**
- Consumes: `ConfirmDialog`, `ProgressBar`, `EmptyState`, `format.js`, `api.js`(`deleteDocument`, `updateChecklistItem`, `setDocumentCompleted`)
- Produces: `OngoingPage({ onNavTo, toast })`, `CompletedPage({ onNavTo, toast })`

- [ ] **Step 1: OngoingPage 이관 + 삭제 경로 통일**

`LittleBoss.jsx:1419-1540`을 옮긴다.

**핵심 변경:**
- `window.confirm`(현 `LittleBoss.jsx:1440`)을 `ConfirmDialog`로 교체한다. 확인 버튼은 `variant="danger"`.
- `🗑️` 이모지 버튼을 `Trash` 아이콘 버튼으로 바꾼다.
- 분석 중 상태에 스피너와 안내를 넣는다:

```jsx
{processing && (
  <div className="analyzing">
    <span className="spinner" />
    <span>AI가 분석 중입니다 · 보통 30초~2분 걸립니다</span>
  </div>
)}
```

```css
.analyzing {
  display: flex; align-items: center; gap: 10px;
  margin-top: var(--space-3); padding: 10px 14px;
  background: var(--brand-soft); color: var(--brand);
  border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 600;
}
```

- [ ] **Step 2: CompletedPage 이관**

`LittleBoss.jsx:1542-1669`를 옮긴다. 이미 커스텀 모달을 쓰고 있으므로 `ConfirmDialog`로 교체하면 두 화면이 같은 경로를 쓰게 된다. 기존 모달의 확인 버튼이 `btnPrimary`(브랜드 보라)였던 것을 `variant="danger"`로 바꾼다.

빈 상태는 이미 잘 되어 있으므로 `EmptyState` 컴포넌트로 바꾸기만 한다(아이콘은 `CheckCircle`).

- [ ] **Step 3: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 진행 중인 문서에서 삭제를 누르면 `window.confirm`이 아니라 앱 모달이 뜬다
- 모달의 확인 버튼이 **빨간색**이고, 열자마자 포커스가 **취소**에 있다
- Enter를 눌렀을 때 삭제되지 않는다
- Esc로 모달이 닫힌다
- 완료된 문서의 삭제도 같은 모달을 쓴다
- 분석 중 문서에 스피너가 돈다

- [ ] **Step 4: 커밋**

```bash
cd frontend
git add src/pages/OngoingPage.jsx src/pages/CompletedPage.jsx src/styles/components.css
git commit -m "feat(docs): 진행 중·완료된 문서 이관과 삭제 경로 통일

- window.confirm과 커스텀 모달로 갈려 있던 삭제를 ConfirmDialog 하나로
- 확인 버튼을 브랜드 보라에서 경고색으로 바꾸고 기본 포커스를 취소에
- 분석 중 상태에 스피너와 예상 소요 시간 표시"
```

---

## Task 10: 문서 상세와 일정 상세

**Files:**
- Create: `frontend/src/pages/DocumentDetailPage.jsx` `frontend/src/pages/ScheduleDetailPage.jsx`

**Interfaces:**
- Consumes: `format.js`, `Card`, `Chip`, `Button`, `EmptyState`, `api.js`(`updateChecklistItem`)
- Produces: `DocumentDetailPage({ data, prevSub, onNavTo, toast })`, `ScheduleDetailPage({ day, title, prevSub, onNavTo, toast })`

- [ ] **Step 1: D-day 뱃지에 대상 라벨 추가**

두 화면 모두 D-day 뱃지를 `formatDeadlineWithLabel`로 바꾼다. 라벨 소스는 `deadlineDesc`(백엔드 `deadlines[0].description`)다.

```jsx
<Chip tone={deadlineTone(deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
  {formatDeadlineWithLabel(deadlineDesc, deadlineDate)}
</Chip>
```

`deadlineDesc`가 비어 있으면 `formatDeadlineWithLabel`이 표기만 반환하므로 기존 동작과 같다.

- [ ] **Step 2: 필요 서류 "없음"과 "추출 실패" 구분**

`toScreenDoc`(`src/lib/api.js`)의 결과에서 판별한다. `analysis.required_documents`가 **빈 배열**이면 "필요 없음", **없거나 undefined**면 "추출 실패"로 본다. `toScreenDoc`에 플래그를 추가한다:

```js
// src/lib/api.js 의 toScreenDoc 안
const reqDocs = a.required_documents;
...
extractionFailed: !Array.isArray(reqDocs),
```

화면에서:

```jsx
{checks.length === 0 && (
  extractionFailed ? (
    <EmptyState
      icon={FileText}
      title="서류 목록을 추출하지 못했어요"
      desc="문서가 스캔본이거나 형식이 특이할 때 발생합니다. 다시 분석해 보세요."
      actionLabel="다시 분석하기"
      onAction={handleReanalyze}
    />
  ) : (
    <EmptyState icon={CheckCircle} title="제출할 서류가 없는 문서예요" />
  )
)}
```

`handleReanalyze`는 기존 업로드 폴링(`pollUntilDone`)을 그대로 재사용해 해당 `doc_id`를 다시 조회한다. 새 API를 만들지 않는다.

- [ ] **Step 3: 메모 저장 피드백**

현재 메모는 `localStorage`에 저장되지만(`LittleBoss.jsx:1729`) 저장 여부를 알 수 없다. 저장 시각을 함께 저장하고 표시한다.

```jsx
const [savedAt, setSavedAt] = useState(() => {
  try { return localStorage.getItem(`${memoKey}:at`) || ''; } catch { return ''; }
});

const saveMemo = () => {
  const now = new Date().toISOString();
  try {
    localStorage.setItem(memoKey, memo);
    localStorage.setItem(`${memoKey}:at`, now);
  } catch { /* 차단 환경 */ }
  setSavedAt(now);
  toast('메모를 저장했어요');
};
```

저장 버튼 옆에 표시:

```jsx
{savedAt && <span className="t-caption">마지막 저장 {new Date(savedAt).toLocaleString('ko-KR')}</span>}
```

- [ ] **Step 4: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 문서 상세의 D-day 뱃지가 `신청 마감 D-4` 형태로 뜬다(설명이 있는 문서 기준)
- 필요 서류가 빈 문서에서 "제출할 서류가 없는 문서예요"가 뜬다
- 메모를 저장하면 토스트가 뜨고 "마지막 저장 …" 이 표시된다
- 새로고침해도 메모와 저장 시각이 유지된다

- [ ] **Step 5: 커밋**

```bash
cd frontend
git add src/pages/DocumentDetailPage.jsx src/pages/ScheduleDetailPage.jsx src/lib/api.js
git commit -m "feat(detail): 상세 화면 이관과 정보 명확화

- D-day 뱃지에 무엇의 마감인지 라벨 표기
- 서류 '없음'과 '추출 실패'를 구분하고 실패 시 다시 분석하기 제공
- 메모 저장 시 토스트와 마지막 저장 시각 표시"
```

---

## Task 11: 내 정보 (탭 3개) 와 테마 토글

**Files:**
- Create: `frontend/src/pages/profile/ProfilePage.jsx` `ProfileInfo.jsx` `NotificationSettings.jsx` `Connections.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `Field`, `Toggle`, `Button`, `ConfirmDialog`, `useTheme`, `auth.js`, `api.js`
- Produces: `ProfilePage({ toast, onLogout })`

- [ ] **Step 1: 453줄을 탭 3개로 분할**

`LittleBoss.jsx:1931-2383`을 세 파일로 나눈다.

- `ProfileInfo.jsx` — 프로필 사진, 이름, 이메일, 소속, 저장, 비밀번호 변경
- `NotificationSettings.jsx` — 알림 토글 5종 (`DEFAULT_NOTIF`, `LittleBoss.jsx:1929`)
- `Connections.jsx` — Google 캘린더 연결/해제, 회원 탈퇴

`ProfilePage.jsx`는 탭 전환만 한다.

- [ ] **Step 2: 이메일 비활성 사유와 소속 이점 안내**

`Field`의 `hint`를 쓴다.

```jsx
<Field
  label="이메일"
  value={user.email}
  disabled
  hint="가입 시 사용한 이메일은 변경할 수 없어요."
/>

<Field
  label="소속"
  value={affiliation}
  onChange={(e) => setAffiliation(e.target.value)}
  placeholder="예: 소프트웨어학과"
  hint="소속을 입력하면 학과별 공지에 맞춘 안내를 받을 수 있어요."
/>
```

- [ ] **Step 3: 화면 설정(테마 토글) 추가**

`ProfileInfo.jsx` 하단에 섹션을 추가한다.

```jsx
import { useTheme } from '../../lib/useTheme';
...
const { theme, setTheme } = useTheme();
...
<Card title="화면 설정">
  <div className="theme-row">
    {[['system', '시스템 설정'], ['light', '라이트'], ['dark', '다크']].map(([v, label]) => (
      <button
        key={v}
        className={`theme-opt ${theme === v ? 'theme-opt-on' : ''}`}
        onClick={() => setTheme(v)}
      >
        {label}
      </button>
    ))}
  </div>
</Card>
```

```css
.theme-row { display: flex; gap: var(--space-2); }
.theme-opt {
  flex: 1; padding: 10px; border-radius: var(--radius-sm);
  border: 1.5px solid var(--border); background: var(--surface);
  color: var(--text-muted); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all .2s var(--ease);
}
.theme-opt-on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
```

- [ ] **Step 4: 캘린더 토큰 만료를 로그아웃처럼 보이지 않게**

`Connections.jsx`에서 `auth.js`의 `getCalendarToken`/`clearCalendarToken`을 쓴다. 토큰이 없으면 "연결되지 않음" 상태로 표시하고 재연결 버튼을 둔다. **`clearSession()`을 호출하지 않는다.**

업로드 화면의 캘린더 등록 실패 처리(`LittleBoss.jsx:1086`)도 `clearCalendarToken()`만 부르고 다음 문구로 안내한다:

```js
toast('캘린더 연결이 만료됐어요. 내 정보 > 연결된 서비스에서 다시 연결해 주세요.');
```

- [ ] **Step 5: 사이드바에서 "내 정보" 제거**

`Sidebar.jsx`에서 `<NavItem id="sub-profile" ... />`를 삭제한다. 진입 경로는 헤더의 프로필 드롭다운 하나만 남는다.

- [ ] **Step 6: 실제로 띄워 확인**

Run: `cd frontend && npm run dev`

확인 항목:
- 내 정보가 탭 3개로 나뉘어 있다
- 이메일 필드 아래에 변경 불가 안내가 보인다
- 소속 필드 아래에 입력 이점 안내가 보인다
- 화면 설정에서 다크를 고르면 즉시 반전되고, 새로고침해도 유지된다
- 시스템 설정을 고른 뒤 OS 테마를 바꾸면 따라간다
- **사이드바에 "내 정보"가 없고**, 헤더 프로필 드롭다운으로만 들어간다

- [ ] **Step 7: 커밋**

```bash
cd frontend
git add src/pages/profile src/components/Sidebar.jsx src/styles/components.css src/pages/UploadPage.jsx
git commit -m "feat(profile): 내 정보를 탭 3개로 분할하고 테마 토글 추가

- 453줄 단일 컴포넌트를 프로필/알림/연결로 분리
- 이메일 비활성 사유와 소속 입력 이점을 필드 힌트로 안내
- 캘린더 토큰 만료 시 세션을 지우지 않고 재연결만 안내
- '내 정보' 진입 경로를 프로필 드롭다운 하나로 통일"
```

---

## Task 12: 원본 정리와 랜딩 토큰 공유

**Files:**
- Delete: `frontend/LittleBoss.jsx` `frontend/api.js`(shim)
- Modify: `frontend/index.html`
- Modify: `frontend/vite.config.js` (확인만)

**Interfaces:**
- Consumes: `src/styles/tokens.css`
- Produces: 랜딩이 앱과 같은 토큰을 쓰는 상태

- [ ] **Step 1: 원본 파일 삭제**

```bash
cd frontend
git rm LittleBoss.jsx api.js
```

- [ ] **Step 2: 남은 참조 확인**

Run: `cd frontend && grep -rn "LittleBoss'" src/ ; grep -rn "from './api'" src/ ; grep -rn "ddayInfo" src/`
Expected: 출력 없음. 있으면 해당 파일을 `src/lib/api.js` / `src/lib/format.js`로 고친다.

- [ ] **Step 3: 이모지 잔존 확인**

Run: `cd frontend && grep -rn "🏠\|📎\|📁\|📅\|📋\|✅\|👤\|🔍\|📭\|📂\|🔔\|📄\|🗑️\|⚠️\|👋\|📩" src/`
Expected: 출력 없음.

- [ ] **Step 4: 랜딩이 토큰을 공유하게 수정**

`frontend/index.html`:

1. `<html lang="ko">` → `<html lang="ko" data-theme="light">` (랜딩은 1차에서 라이트 고정)
2. `<head>` 안, 기존 `<style>` **앞에** 추가:

```html
<link rel="stylesheet" href="/src/styles/tokens.css" />
```

3. 기존 `:root { --purple: … }` 블록(현 `index.html:9-20`)을 **삭제**하고, 같은 `<style>` 안에서 예전 이름을 새 토큰으로 잇는 별칭만 남긴다:

```css
:root {
  --purple: var(--brand);
  --purple-dark: var(--brand-strong);
  --purple-light: var(--brand-light);
  --purple-bg: var(--brand-soft);
  --text-dark: var(--text);
  --text-mid: var(--text-muted);
  --text-light: var(--text-subtle);
  --white: var(--surface);
  --bg: var(--surface-sunken);
  --grad: var(--brand-gradient);
}
```

> 이렇게 하면 랜딩의 나머지 CSS를 한 줄도 고치지 않고 토큰만 공유된다.

- [ ] **Step 5: 랜딩 기능 카드 아이콘 교체**

`index.html`의 `.feature-icon`(현 `index.html` 내 `width:52px; height:52px; background: var(--grad); border-radius:14px;`)에서 **그라디언트 박스를 제거**하고 아이콘 자체를 키운다.

```css
.feature-icon {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
  color: var(--brand);
  background: none; box-shadow: none; border-radius: 0;
}
.feature-icon svg { width: 44px; height: 44px; stroke-width: 1.6; }
```

각 카드의 `<svg>`에서 `stroke="white"`를 `stroke="currentColor"`로 바꾼다(5곳).

> **랜딩의 "분석 결과" 예시 카드는 그대로 둔다.** 스펙 §5의 "예시 카드 톤을 실제 상세 화면과 맞춤"은 두 방향(랜딩을 낮추기 / 실제 화면을 올리기) 중 **후자로 해결된다.** Task 10에서 실제 문서 상세에 `신청 마감 D-4` 형태의 라벨 뱃지가 들어가므로, 랜딩 예시의 D-3·D-8·D-23 뱃지와 실제 화면이 같은 결이 된다. 랜딩 예시 마크업은 수정하지 않는다.

- [ ] **Step 6: 빌드와 두 페이지 확인**

Run: `cd frontend && npm run build && npm run preview`

확인 항목:
- `/index.html` 랜딩이 예전과 같은 색으로 뜬다
- 랜딩 기능 카드 5종이 보라 박스 없이 아이콘 실루엣으로 구분된다
- OS를 다크로 바꿔도 **랜딩은 라이트를 유지한다**
- `/app.html` 앱이 정상 동작한다

- [ ] **Step 7: 커밋**

```bash
cd frontend
git add -A
git commit -m "refactor: LittleBoss.jsx 제거하고 랜딩과 토큰 공유

- 2,466줄 단일 파일과 임시 shim 삭제
- 랜딩이 tokens.css를 참조하고 기존 변수는 별칭으로 연결해
  나머지 CSS를 고치지 않고 토큰만 공유
- 랜딩 기능 카드에서 그라디언트 박스를 걷어내고 아이콘을 키움"
```

---

## Task 13: 검수와 배포

**Files:**
- Modify: 검수에서 발견된 파일

- [ ] **Step 1: 자동 검사 전부 통과 확인**

```bash
cd frontend
npm test
npm run build
```

Expected: 테스트 28개 통과, 빌드 성공.

- [ ] **Step 2: 다크모드 양방향 토글 검사**

이 검사가 Global Constraints의 다크 규칙이 지켜졌는지 확인하는 유일한 방법이다.

1. OS를 **라이트**로 두고 앱에서 다크를 고른다 → 다크로 보여야 한다
2. OS를 **다크**로 두고 앱에서 라이트를 고른다 → 라이트로 보여야 한다
3. 앱에서 "시스템 설정"을 고르고 OS 테마를 바꾼다 → 따라가야 한다
4. 각 상태에서 새로고침 → 유지되어야 한다

한 방향만 동작하면 `tokens.css`의 다크 블록 두 곳 중 하나가 빠진 것이다.

- [ ] **Step 3: 화면별 수동 체크리스트**

9개 화면 각각을 **라이트/다크**에서 확인한다.

- [ ] 1280 / 1024 / 768 / 400px 폭에서 가로 스크롤이 생기지 않는다
- [ ] 모든 빈 상태가 `EmptyState`를 쓴다(대시보드 히어로, 일정 관리, 업로드 우측, 진행 중, 완료된 문서, 최근 문서)
- [ ] 다크에서 본문 텍스트가 배경 대비 4.5:1 이상이다 (브라우저 개발자도구 > 요소 선택 > 대비비 확인)
- [ ] 삭제가 전부 `ConfirmDialog`를 거치고 확인 버튼이 빨간색이다
- [ ] 새로고침 후 로그인 상태와 테마가 유지된다
- [ ] 키보드 Tab만으로 모든 버튼에 도달할 수 있고 포커스 링이 보인다
- [ ] 모바일 폭에서 확대(핀치 줌)가 동작한다

- [ ] **Step 4: 발견된 문제 수정 후 커밋**

```bash
cd frontend
git add -A
git commit -m "fix: 재설계 검수에서 발견된 문제 수정"
```

- [ ] **Step 5: 브랜치 머지와 배포**

```bash
cd "C:/univercity/Project (Cab Stone)/littleboss"
git checkout main
git merge --no-ff feature/ui-redesign -m "Merge feature/ui-redesign: UI 전면 재설계"
cd frontend && npm run build
```

`dist/`를 기존 GitHub Pages 절차로 배포한다. 백엔드 재배포는 없다.

- [ ] **Step 6: After 목업 소스 확보**

배포된 9개 화면을 라이트 모드에서 각각 캡처해 Figma `LittleBoss UI 개선 발표` 파일의 After 플레이스홀더를 교체한다. 대상 파일: https://www.figma.com/design/NpiYDC2pcisfADDIfkk72I

---

## 미해결 항목

- **캘린더 13~15일 연보라 하이라이트** — 소스와 배포 번들 어디에서도 재현되지 않았다. Task 8에서 방어 코드만 넣었다. 스크린샷이 확보되면 별도 태스크로 다룬다.
- **랜딩 다크모드** — 1차 범위 밖. 랜딩은 `data-theme="light"` 고정.
- **S2 (PWA + 푸시 알림)** — 별도 계획. EventBridge Scheduler 경로가 스파이크로 검증돼 있다.
