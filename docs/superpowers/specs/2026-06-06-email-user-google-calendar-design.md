# 이메일 가입 유저 Google 캘린더 연동 설계

- 날짜: 2026-06-06
- 대상: `frontend/LittleBoss.jsx` (프론트엔드 전용)
- 상태: 설계 승인됨, 구현 대기

## 목표

이메일/비밀번호로 가입한 유저도 Google 캘린더를 연결해서, 문서 분석으로 추출된
일정이 본인 Google 캘린더에 등록되도록 한다. 현재는 웹 Google 로그인 유저와
Slack 유저만 캘린더 연동이 되고, 이메일 가입 유저는 연결할 방법이 없다.

## 접근 모델: Route A (클라이언트 access token)

웹 Google 로그인 유저가 이미 쓰는 방식과 동일하게, `useGoogleLogin`(implicit flow)으로
`calendar.events` 스코프 access token을 받아 localStorage `user_token`에 저장한다.
서버사이드 refresh token 저장(Slack 방식, Route B)은 채택하지 않는다 — 백엔드 변경과
평문 토큰 저장 보안 부담을 피하고, 웹 Google 유저와 동일한 경험으로 일관성을 맞춘다.

**트레이드오프(수용):** access token은 약 1시간 만료, 브라우저가 열려 있을 때만 동작.
이는 웹 Google 로그인 유저가 이미 가진 제약과 동일하다.

## 비목표 (YAGNI)

- 서버사이드 refresh token 저장 / 비동기 자동등록 (Route B).
- 백엔드 / API Gateway / Lambda 변경 — 이 기능은 프론트 전용.
- `GoogleBtn`(로그인 버튼) 수정 — 로그인 회귀 위험을 피하기 위해 건드리지 않는다.
- 토큰 만료를 미리 검사하는 타이머 / 앱 로드 시 검사.

## 핵심 컴포넌트: `ConnectGoogleCalendar`

새 작은 컴포넌트. `GoogleBtn`과 동일하게 `useGoogleLogin`(scope
`openid email profile https://www.googleapis.com/auth/calendar.events`)을 사용하되,
onSuccess 동작이 다르다.

- access token을 받아 **`user_token`에만** 저장한다.
- **신원(user_id / user_email / user_name)은 절대 변경하지 않는다.** `GoogleBtn`은
  onSuccess에서 `user_id = google sub`로 덮어쓰는데, 이메일 유저에게는 그것이
  "계정 전환"이 되어 문서가 다른 user_id로 분리돼 버린다. 이 컴포넌트는 신원을
  건드리지 않고 캘린더 쓰기용 토큰만 확보한다.
- 인증한 Google 계정이 가입 이메일과 달라도 무방하다 — "어느 캘린더에 쓸지"만 정하는
  것이고 앱 신원은 가입 이메일 그대로 유지된다.
- 성공 시 토스트 안내 + 화면 갱신. 갱신은 기존 "연결 해제"가 쓰는
  `window.location.reload()` 패턴을 그대로 따른다(설정 탭의 연동 상태는 localStorage를
  직접 읽는 IIFE라 React state 갱신 대신 reload가 일관적).
- 실패 시 `toast`로 안내.

인터페이스:

```jsx
function ConnectGoogleCalendar({ toast, label = "Google 캘린더 연결하기" }) { ... }
```

## 배치

**설정 → 캘린더 연동 탭, 미연동 상태**가 캐노니컬 진입점이다.
(`LittleBoss.jsx` line ~2202, `settingsTab === "calendar"`.)

- 미연동 블록(현재 "미연동 / Google 로그인 시 캘린더가 자동 연결됩니다.")에
  `ConnectGoogleCalendar` 버튼을 추가한다.
- 미연동 안내 문구를 이메일 유저에 맞게 수정: "Google 로그인 시 캘린더가 자동
  연결됩니다." → "아래 버튼으로 Google 캘린더를 연결하세요."
- 업로드 결과 화면의 안내 문구(line ~1067, ~1188 "Google 로그인하면...")는 카피만
  정정: "설정에서 Google 캘린더를 연결하면 일정이 자동 등록됩니다." (동작 변경 없음)

## 데이터 흐름 (기존 코드 재사용, 변경 없음)

연결 후 `user_token`이 존재하면 다음이 모두 기존 코드로 동작한다:

- 분석 완료 후 자동등록 (line ~1058: `if (evCount > 0 && token)`).
- "캘린더에 다시 등록" 버튼 (line ~1187).
- 설정 탭 "✅ 연동 완료" 표시 + "연결 해제" 버튼 (line ~2203, `user_token` 제거).

`registerCalendar(docId, userToken)` → `POST /calendar/{docId}` → `action_handler.handle_calendar`
→ `utils/calendar.create_events` 경로는 그대로다. **백엔드 변경 없음.**

## 만료 처리 (lazy, 파일 처리 시점 한 곳)

access token은 약 1시간 만료. 만료 후 등록을 시도하면 Google이 401을 반환하고,
`create_events`는 각 이벤트를 `status: "failed"`로 담아 돌려준다(`handle_calendar`는
그래도 `success: True`로 응답).

만료 처리는 **자동등록 경로(파일 처리 시점, line ~1054 근처) 한 곳에서만** 수행한다:

- 등록 결과 `created_events`가 비어 있지 않고 **전부 `status !== "created"`(전부 실패)** 이면,
  토큰 만료로 간주하여:
  - `localStorage.removeItem("user_token")`
  - 안내 메시지: "Google 연결이 만료됐어요. 설정에서 다시 연결해주세요."

- "다시 등록" 버튼과 설정 탭에는 만료 검사/정리 로직을 넣지 않는다(토큰을 그대로 둠).

**수용하는 트레이드오프:** 설정 탭의 "연동 완료"는 토큰이 실제로 만료됐어도 다음 파일
처리 전까지 "연동됨"으로 보일 수 있다. 실제 파일 처리 시점에 드러나 정리된다.

이 판정은 프론트에서 `created_events` 상태만 검사하므로 백엔드 변경이 필요 없다.

## 영향 파일

- `frontend/LittleBoss.jsx` — 수정 (신규 컴포넌트 + 설정 탭 버튼 + 자동등록 만료 처리 + 문구 정정)

추가 백엔드/유틸/API 변경 없음.

## 테스트

이 저장소의 프론트엔드는 테스트 인프라 없이 Vite 빌드만 있으므로:

1. `cd frontend && npm run build` — 컴파일 무결성(신규 컴포넌트/JSX 오류 없음) 확인.
2. 수동 시나리오 체크리스트:
   - 이메일 가입 → 설정 → 캘린더 연동 탭에 "연결하기" 버튼 노출.
   - 버튼 클릭 → Google 동의 → "연동 완료" 표시, **user_id/email/name 불변**(문서 목록 유지).
   - 문서 업로드 → 분석 완료 → 일정 자동등록 동작.
   - "연결 해제" → user_token 제거, 미연동 상태 복귀.
   - (만료 시뮬레이션) user_token을 임의 무효값으로 바꾼 뒤 파일 처리 → 전부 실패 →
     "다시 연결" 안내 + user_token 제거 확인.

## 리스크

- access token 1시간 만료 — 설계상 수용(웹 Google 유저와 동일 제약).
- 신원 덮어쓰기 사고를 막는 것이 가장 중요 — onSuccess에서 user_id/email/name을
  건드리지 않는다는 점을 구현·리뷰에서 반드시 확인.
- `GoogleBtn`을 건드리지 않으므로 기존 로그인 경로 회귀 위험 없음.
