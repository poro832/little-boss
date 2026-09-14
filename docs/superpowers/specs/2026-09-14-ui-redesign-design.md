# UI 전면 재설계 (교수님 피드백 반영) 설계

- 날짜: 2026-09-14
- 대상: `frontend/` 전체 (`LittleBoss.jsx`, `api.js`, `app.html`, `index.html`)
- 상태: 설계 승인됨, 구현 대기
- 관련: `docs/superpowers/specs/` 이전 스펙들, Figma `LittleBoss UI 개선 발표` (https://www.figma.com/design/NpiYDC2pcisfADDIfkk72I)

## 목표

학술대회 심사 피드백("아이콘이 간결함 / 템플릿을 그대로 가져와서 내용만 넣은 것 같음", "로그인 없이 마감을 바로 볼 수 있는 위젯", "자동 로그인")에 대응해 웹앱의 시각 언어와 정보구조를 다시 세운다.

세 가지를 동시에 해결한다.

1. **템플릿 인상 제거** — 랜딩 페이지가 이미 갖고 있는 디자인 언어를 앱으로 확장한다.
2. **구조적 부채 해소** — 인라인 스타일 487개 / 2,466줄 단일 파일을 CSS 변수 + 컴포넌트 구조로 옮긴다.
3. **정보 중복 제거** — 대시보드와 일정 관리가 같은 정보를 반복하는 문제를 역할 분리로 해결한다.

이 작업이 끝난 화면이 그대로 발표 자료의 After 목업이 된다.

## 배경 / 현재 동작

`frontend/LittleBoss.jsx` 2,466줄에 21개 컴포넌트가 들어 있다. 측정된 현황:

- `style={{...}}` 인라인 객체 **487개**, `className` **0개**, CSS 파일 없음. `<style>` 주입은 `lbpulse` 키프레임과 focus 링 한 줄뿐(`LittleBoss.jsx:2435`).
- 색은 `C` 객체(`LittleBoss.jsx:8`)로 토큰화돼 있으나 **간격·라운드·그림자·타이포는 토큰화되지 않았다**. 그림자/오버레이 `rgba()`가 20군데 흩어져 있다.
- 호버를 `useState` + `onMouseEnter`로 5곳에서 수동 구현한다. `::after`, `@media`, `:focus-visible`는 인라인으로 불가능하다.
- 큰 컴포넌트: `ProfilePage` 453줄, `UploadPage` 267줄, `Dashboard` 258줄, `Header` 199줄.

반면 랜딩(`frontend/index.html`)은 CSS 커스텀 프로퍼티와 클래스를 제대로 쓰는 손수 만든 페이지다. **색 팔레트는 앱과 동일**하지만 랜딩만 가진 것이 있다.

| 요소 | 랜딩 | 앱 |
|---|---|---|
| 그라디언트 | `--grad` 135° 3-stop | 없음 (단색) |
| 제목 굵기 | 800 + `letter-spacing:-0.02em` | 최대 700 (폰트를 700까지만 로드) |
| 서체 | Noto Sans KR + DM Sans | Noto Sans KR만 |
| 라운드 스케일 | 6·10·12·14·16·18·28·999 | 8·10·12·14 |
| 그림자 | 보라 틴트 레이어드 | 1종 |
| 호버 | 전역 `translateY(-2px)` | 5곳 수동 |
| 배경 깊이 | blob blur + radial + 마스킹 그리드 | 단색 |

**즉 앱은 랜딩과 같은 색을 쓰면서 랜딩을 랜딩답게 만드는 것을 하나도 쓰지 않는다.** 이것이 "템플릿에 내용만 넣은 것 같다"는 지적의 실체다.

추가로 발견한 것: `frontend/app.html`의 뷰포트가 `width=1024, user-scalable=no`로 고정돼 있어 JSX의 `useIsMobile(768)` 반응형 분기를 무력화하고 있다. 타이틀은 `26 Capstone`이며, 배포본에 Figma capture 스크립트가 남아 있다.

## 결정 사항 (브레인스토밍 합의)

1. **비주얼 방향** — 랜딩의 디자인 언어를 앱으로 확장한다. 앱만 새로 만들지 않는다.
2. **스타일링** — CSS 파일 + CSS 변수 + `className`. 랜딩과 토큰 파일을 공유한다.
3. **반응형** — 데스크톱 우선, 모바일은 깨지지 않게. 뷰포트 고정을 해제한다.
4. **아이콘** — 이모지를 전면 제거하고 랜딩의 라인 스타일로 자체 SVG 약 20종을 만든다.
5. **다크모드** — 처음부터 포함한다. 단 1차에서는 앱만 지원하고 랜딩은 라이트 고정.
6. **대시보드 정보구조** — A안(마감 중심). 가장 급한 마감 1건을 히어로로 삼고 캘린더는 일정 관리로 이관한다.

## 설계

### 1) 디자인 토큰 (`src/styles/tokens.css`)

색을 값 이름이 아니라 **의미 이름**으로 정의한다. 현재 `C.bg`, `C.textMid` 같은 이름은 다크모드에서 거짓이 된다(`bg`가 어두워지므로).

```css
:root {
  color-scheme: light;
  --surface: #FFFFFF;
  --surface-sunken: #F2F1F6;
  --surface-raised: #FFFFFF;
  --text: #1A1025;
  --text-muted: #5A4D7A;
  --text-subtle: #9B90B8;
  --border: #E8E4F4;
  --border-strong: #D8D3E6;
  --brand: #6B4FE8;
  --brand-strong: #5038C4;
  --brand-soft: #F0ECFF;
  --brand-gradient: linear-gradient(135deg, #8B72F0 0%, #6B4FE8 48%, #5038C4 100%);
  --danger: #E53E3E;   --danger-soft: #FFF0F0;
  --success: #22C55E;  --success-soft: #F0FFF4;
  --warning: #EA580C;  --warning-soft: #FFF7ED;
  --today: #0066CC;    --today-soft: #E0F2FE;

  --radius-xs: 6px; --radius-sm: 10px; --radius-md: 14px;
  --radius-lg: 18px; --radius-xl: 28px; --radius-pill: 999px;

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  --shadow-card: 0 1px 8px rgba(107,79,232,.07);
  --shadow-hover: 0 16px 44px rgba(107,79,232,.16);
  --shadow-brand: 0 10px 28px rgba(107,79,232,.30);

  --font-sans: 'Noto Sans KR', system-ui, sans-serif;
  --font-num: 'DM Sans', 'Noto Sans KR', sans-serif;
}

[data-theme="dark"] {
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
  --danger-soft: #2E1A1A;
  --success-soft: #16281C;
  --warning-soft: #2C1D10;
  --today-soft: #12283A;
  --shadow-card: 0 1px 8px rgba(0,0,0,.40);
  --shadow-hover: 0 16px 44px rgba(0,0,0,.55);
}
```

**다크모드 규칙**

- 라이트 팔레트를 맨 `:root`에 전부 정의한다. 다크 블록에서는 **달라지는 토큰만** 재정의한다.
- 시스템 설정 대응은 `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`로 하고, 명시 선택은 `[data-theme="dark"]`가 이긴다. 즉 다크 값 블록을 두 번 쓴다(미디어쿼리 안, 속성 선택자).
- 어떤 색도 미디어쿼리나 `[data-theme]` 안에서만 정의하지 않는다.
- 테마 선택은 `localStorage.theme`(`light`/`dark`/`system`)에 저장하고 `<html data-theme>`에 반영한다. 내 정보 → 화면 설정에 토글을 둔다.

**폰트** — 앱도 랜딩과 같은 웨이트를 로드한다(`300;400;500;700;800` + DM Sans). 현재 앱은 700까지만 로드해 800이 렌더되지 않는다.

**랜딩 공유** — `index.html`이 `tokens.css`를 `<link>`로 참조하고 기존 `--purple` 계열 변수를 여기 정의된 이름으로 교체한다. 랜딩에는 `<html data-theme="light">`를 박아 다크가 적용되지 않게 한다.

### 2) 아이콘 (`src/icons/index.jsx`)

랜딩의 `DocIcon`/`CheckIcon`/`CalIcon`(`LittleBoss.jsx:151-160`) 스타일을 기준으로 삼는다: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`.

공통 래퍼 하나와 named export 20종:

```
Home Upload Folder Calendar ListCheck CheckCircle User
Search Bell Trash Pencil Close ChevronDown ChevronRight ArrowLeft
FileText Inbox FolderOpen Lock Sparkle
```

`stroke="currentColor"`이므로 색은 CSS에서 정한다. 사용처는 이모지를 쓰던 자리 전부 — 사이드바 7, 빈 상태 4, 알림 3, 검색·업로드·삭제 등.

랜딩의 기능 카드 5종은 **보라 그라디언트 박스를 없애고** 아이콘 자체를 크게(40px) 두어 실루엣으로 구분되게 한다. 이것이 "아이콘이 간결함" 지적에 대한 직접적인 답이다.

### 3) 파일 구조

```
frontend/src/
  styles/
    tokens.css        디자인 토큰 (라이트/다크) — 랜딩과 공유
    base.css          reset, 타이포, :focus-visible, 스크롤바
    components.css    .btn .card .chip .field .toggle .empty .badge …
  icons/
    index.jsx         SVG 20종
  lib/
    api.js            (기존 frontend/api.js 이동)
    format.js         ddayInfo · 지난 일정 표기 · 날짜 포맷 ← 단일 진실 공급원
    auth.js           세션 읽기/쓰기, 캘린더 토큰 만료 처리
    useDocuments.js   useToast.js   useIsMobile.js   useTheme.js
  components/
    AppShell.jsx  Header.jsx  Sidebar.jsx
    EmptyState.jsx  Skeleton.jsx  Toast.jsx  ConfirmDialog.jsx
    Button.jsx  Card.jsx  Chip.jsx  Field.jsx  Toggle.jsx  ProgressBar.jsx
  pages/
    auth/       AuthLayout.jsx  LoginPage.jsx  SignupPage.jsx  ForgotPasswordPage.jsx
    DashboardPage.jsx  UploadPage.jsx  SchedulePage.jsx
    OngoingPage.jsx    CompletedPage.jsx
    DocumentDetailPage.jsx  ScheduleDetailPage.jsx
    profile/    ProfilePage.jsx  ProfileInfo.jsx  NotificationSettings.jsx  Connections.jsx
  App.jsx
  main.jsx
```

**경계 근거**

- `ProfilePage` 453줄은 프로필 / 알림 설정 / 연결된 서비스 세 가지 일을 한다. 탭 3개로 분리한다.
- `format.js`를 신설한다. 지금 D-day 표기를 각 페이지가 따로 조립해서(`LittleBoss.jsx:870, 1331, 1498, 1693`) 화면마다 표기가 다르다. 한 곳으로 모으는 것이 표기 통일 버그의 근본 해결이다.
- `ConfirmDialog`를 신설한다. 지금 삭제가 `window.confirm`(`LittleBoss.jsx:1440`)과 커스텀 모달(`LittleBoss.jsx:1645-1653`) 두 가지로 갈려 있다.
- `EmptyState`는 이미 존재하나(`LittleBoss.jsx:56`) 완료된 문서 화면에서만 제대로 쓰인다. 이를 표준 패턴으로 삼아 대시보드·일정 관리·업로드에 이식한다.

### 4) 대시보드 (A안 · 마감 중심)

```
가장 급한 마감                                    [히어로]
  D-3 · 서류 제출 마감 · 2026-09-24 18:00
  준비물 2 / 5  ▓▓▓▓░░░░░░
  [체크리스트 열기]

다음 마감 3건                    준비물 요약
  D-8   성적증명서 제출            오늘 챙길 서류 체크박스
  D-21  장학위원회 개최            (체크 시 즉시 반영)
  [일정 관리에서 전체 보기]

최근 분석된 문서 (검색 · 필터 · 3건)
```

- **캘린더를 제거한다.** 일정 관리 페이지가 단독으로 책임진다.
- **통계 4칸을 제거한다.** 전부 0인 신규 사용자에게 주는 인상이 나쁘고, 히어로가 같은 정보를 더 잘 전달한다.
- **마감이 없을 때** 히어로는 `EmptyState`로 대체한다(아이콘 + "아직 마감이 없어요" + 업로드 CTA). 0% 도넛 문제가 여기서 사라진다.
- 히어로의 데이터 소스는 기존 `Dashboard`의 `urgentDoc` 계산(`LittleBoss.jsx:802-806`)을 그대로 쓴다.

### 5) 화면별 반영 사항

| 화면 | 변경 |
|---|---|
| 랜딩 | 기능 카드 아이콘을 그라디언트 박스 없이 재구성. 예시 카드 톤을 실제 상세 화면과 맞춤 |
| 로그인/회원가입 | "로그인 상태를 유지합니다" 안내 노출. 약관 `label`이 `input`을 감싸도록 수정 |
| 대시보드 | A안으로 재구성 |
| 문서 업로드 | 분석 완료 0건일 때 우측 패널에 `EmptyState` |
| 문서 상세 | D-day 뱃지에 대상 라벨("신청 마감 D-4"). 서류 "없음"과 "추출 실패"를 구분하고 실패 시 재분석 버튼. 메모 저장 시 토스트 + 마지막 저장 시각 |
| 일정 관리 | 캘린더 단독 책임. 지난 일정 표기를 `format.js`로 통일 |
| 진행 중인 문서 | 삭제를 `ConfirmDialog`로 통일하고 확인 버튼을 `--danger`로. 분석 중 스피너 + 예상 소요 시간 |
| 완료된 문서 | 변경 없음 (기준 패턴) |
| 내 정보 | 탭 3개로 분리. 이메일 비활성 사유 안내, 소속 입력 이점 안내, 화면 설정(테마 토글) 추가 |

### 6) 함께 처리하는 수정

| 항목 | 위치 |
|---|---|
| 뷰포트 고정 해제 (`width=device-width, initial-scale=1`) | `app.html` |
| 타이틀 `26 Capstone` → `LittleBoss` | `app.html` |
| Figma capture 스크립트 제거 | `app.html` |
| 약관 체크박스 클릭 영역 | `SignupPage` |
| 삭제 확인 패턴·색 통일 | `ConfirmDialog` |
| 지난 일정 표기 통일 | `lib/format.js` |
| 캘린더 연보라 하이라이트 | **원인 미확인 — 스크린샷 확보 후 착수** |

## 데이터 흐름

데이터 흐름은 바꾸지 않는다. `useDocuments` → `toScreenDoc` → 화면이라는 기존 경로를 유지하고, 표시 계층만 교체한다. 백엔드·API·DynamoDB 스키마 변경은 없다.

유일한 계층 추가는 `lib/format.js`다. 각 페이지가 `ddayInfo`를 직접 호출해 문자열을 조립하던 것을 `formatDeadline(dateStr)` 한 곳으로 모은다.

## 에러 처리

기존 동작을 유지한다. 추가되는 것은 두 가지다.

- **테마 읽기 실패** — `localStorage` 접근이 막힌 환경(프라이빗 창, 사이트 데이터 차단)에서 throw될 수 있으므로 읽기/쓰기를 `try/catch`로 감싸고 실패 시 `system`으로 동작한다.
- **캘린더 토큰 만료** — 지금은 토큰을 제거만 해서(`LittleBoss.jsx:1086`) 사용자에게 로그아웃된 것처럼 보인다. `auth.js`에서 만료를 감지해 "캘린더 연결이 만료됐어요. 다시 연결할까요?"로 안내하고 로그인 세션은 건드리지 않는다.

## 비목표 (YAGNI)

- **랜딩 다크모드** — 1차 범위 밖. 랜딩은 `data-theme="light"` 고정.
- **모바일 전용 레이아웃** — 데스크톱 우선. 모바일은 깨지지 않는 수준까지만.
- **PWA·푸시 알림** — S2에서 별도로 다룬다.
- **상태 관리 라이브러리 도입** — 현재 훅 기반으로 충분하다.
- **라우터 도입** — 기존 `page`/`sub` 상태 방식을 유지한다. 파일 분리와 라우팅은 별개 문제다.
- **컴포넌트 단위 테스트 인프라** — `format.js`를 제외하고는 붙이지 않는다.

## 영향 파일

- 신설: `src/styles/*`, `src/icons/index.jsx`, `src/lib/*`, `src/components/*`, `src/pages/*`
- 이동: `frontend/api.js` → `src/lib/api.js`
- 해체: `frontend/LittleBoss.jsx` (2,466줄 → 위 구조로 분해 후 삭제)
- 수정: `frontend/app.html`, `frontend/index.html`, `frontend/main.jsx`, `frontend/vite.config.js`
- 백엔드 변경 없음

## 테스트

현재 프론트엔드에는 테스트가 없다. 이번에 전면 도입하지 않고 **가치가 확실한 곳에만** 붙인다.

**`lib/format.js` 단위 테스트** — 순수 함수이며 실제 버그가 보고된 지점이다.

- 미래 날짜 → `D-106`
- 오늘 → `D-Day`
- 과거 날짜 → `84일 지남` (음수 부호가 절대 노출되지 않을 것)
- 3년 전 같은 극단값 → 동일 규칙 적용
- `null` / 빈 문자열 → `마감일 없음`
- 파싱 불가 문자열 → `마감일 미정`

**수동 검증 체크리스트** (화면별, 라이트/다크 각각)

- 9개 화면이 1280·1024·768·400px 폭에서 가로 스크롤 없이 렌더되는가
- 모든 화면의 빈 상태가 `EmptyState` 패턴을 쓰는가
- 이모지가 한 곳도 남아 있지 않은가
- 다크에서 모든 텍스트가 배경 대비 4.5:1 이상인가
- 삭제가 전부 `ConfirmDialog`를 거치며 확인 버튼이 `--danger`인가
- 새로고침 후에도 테마와 로그인 상태가 유지되는가

검증이 끝난 화면이 그대로 발표 자료의 After 목업 소스가 된다.

## 배포

GitHub Pages 정적 배포. `npm run build` 후 `dist/`를 배포하는 기존 절차를 그대로 쓴다. 백엔드 재배포는 없다.

## 리스크

- **한 번에 갈아엎는 규모** — 2,466줄을 해체하므로 회귀 위험이 가장 크다. 완화: 화면 단위로 옮기고 각 화면을 옮길 때마다 실제로 띄워 확인한다. 토큰·아이콘·공통 컴포넌트를 먼저 만들고 화면을 하나씩 이관한다.
- **다크모드가 범위를 키운다** — 색 검수가 두 배가 된다. 완화: 의미 기반 토큰으로 정의해 화면 코드에서는 테마를 의식하지 않게 한다.
- **After 목업 재작업** — 다크까지 포함하면 After 목업도 두 벌이 필요할 수 있다. 발표용으로는 라이트 한 벌로 충분하다고 보고, 다크는 한 화면만 보여주는 것으로 갈음한다.
- **캘린더 하이라이트 원인 미확인** — 소스와 배포 번들 어디에서도 재현되지 않았다. 스크린샷 없이는 착수하지 않는다.
