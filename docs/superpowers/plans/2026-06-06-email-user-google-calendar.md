# 이메일 가입 유저 Google 캘린더 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일/비밀번호로 가입한 유저가 설정에서 Google 캘린더를 연결해, 분석된 일정이 본인 캘린더에 등록되게 한다.

**Architecture:** 프론트 전용(Route A, 클라이언트 access token). 신규 `ConnectGoogleCalendar` 컴포넌트가 `useGoogleLogin`(calendar.events)으로 access token을 받아 `user_token`에만 저장하고 신원은 건드리지 않는다. 설정 캘린더 탭 미연동 상태에 버튼을 추가하면 기존 자동등록/재등록/연동표시 코드가 그대로 동작한다. 만료 토큰은 파일 처리(자동등록) 한 곳에서만 lazy 정리한다. 백엔드 변경 없음.

**Tech Stack:** React 18 + Vite, `@react-oauth/google`(`useGoogleLogin`), 단일 파일 `frontend/LittleBoss.jsx`. 테스트 인프라 없음 → 검증은 `npm run build`(컴파일 무결성) + 수동 체크리스트.

---

## File Structure

- `frontend/LittleBoss.jsx` — 유일한 수정 파일. 변경 단위 4개:
  1. 신규 컴포넌트 `ConnectGoogleCalendar` (GoogleBtn 뒤).
  2. `isEmailUser` 판별을 user_id 기반으로 교정 (캘린더 연결이 노출시키는 회귀 버그 수정).
  3. 설정 캘린더 탭 미연동 분기에 연결 버튼 + 문구 정정.
  4. 자동등록 경로 만료 처리(lazy) + 안내 문구 2곳 정정.

각 단위는 독립적으로 빌드 가능하며 순서대로 커밋한다.

---

### Task 1: `ConnectGoogleCalendar` 컴포넌트 추가

**Files:**
- Modify: `frontend/LittleBoss.jsx` (GoogleBtn 함수 끝 ~285행과 `function DividerOr()` ~287행 사이에 삽입)

- [ ] **Step 1: 컴포넌트 삽입**

`frontend/LittleBoss.jsx`에서 `function DividerOr() {` 바로 앞에 아래 함수를 삽입한다:

```jsx
function ConnectGoogleCalendar({ toast, label = "Google 캘린더 연결하기" }) {
  const connect = useGoogleLogin({
    scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
    onSuccess: (tokenResponse) => {
      // 신원(user_id/email/name)은 건드리지 않고 캘린더 쓰기용 access token만 저장
      localStorage.setItem("user_token", tokenResponse.access_token);
      toast?.("Google 캘린더가 연결됐어요 📅");
      setTimeout(() => window.location.reload(), 600);
    },
    onError: () => toast?.("Google 캘린더 연결 실패. 다시 시도해주세요."),
  });
  return (
    <button onClick={() => connect()} style={{ width: "100%", padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", background: "white", border: "1.5px solid " + C.border, color: C.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <GoogleIcon /> {label}
    </button>
  );
}
```

이 함수는 모듈 스코프의 `useGoogleLogin`(이미 import됨), `C`, `GoogleIcon`만 참조하므로 추가 import가 필요 없다. 이 시점에는 아직 호출되지 않는다(Task 3에서 사용).

- [ ] **Step 2: 빌드로 컴파일 확인**

Run: `cd frontend && npm run build`
Expected: 빌드 성공(에러 없음). `dist/`가 생성되고 "built in ..." 메시지 출력. (미사용 함수 경고는 없음 — JS는 미사용 함수를 오류로 보지 않는다.)

- [ ] **Step 3: 커밋**

```bash
git add frontend/LittleBoss.jsx
git commit -m "feat(calendar): 이메일 유저용 ConnectGoogleCalendar 컴포넌트 추가"
```

---

### Task 2: `isEmailUser` 판별을 user_id 기반으로 교정

**Files:**
- Modify: `frontend/LittleBoss.jsx:1869`

**배경:** 현재 `isEmailUser = !localStorage.getItem("user_token")`는 "토큰 없음 = 이메일 유저"로 판단한다. 이메일 유저가 캘린더를 연결하면 `user_token`이 생겨 `isEmailUser`가 false가 되고, 보안 탭(line ~2186)에서 "비밀번호 변경" UI가 사라지고 "Google 계정은 비밀번호 없음" 문구로 잘못 바뀐다. 이메일 가입자는 user_id가 이메일(`@` 포함), 구글 로그인은 숫자 sub이므로 user_id로 판별하면 토큰 유무와 무관하게 안정적이다.

- [ ] **Step 1: 판별식 교체**

`frontend/LittleBoss.jsx`에서 아래 줄을:

```jsx
  const isEmailUser = !localStorage.getItem("user_token"); // 구글 로그인 사용자는 토큰 보유
```

다음으로 교체한다:

```jsx
  const isEmailUser = (localStorage.getItem("user_id") || "").includes("@"); // 이메일 가입자는 user_id가 이메일(@ 포함), 구글 로그인은 숫자 sub
```

- [ ] **Step 2: 빌드로 컴파일 확인**

Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add frontend/LittleBoss.jsx
git commit -m "fix(settings): isEmailUser를 user_id 기반으로 판별 (캘린더 연결 시 비번변경 UI 사라짐 방지)"
```

---

### Task 3: 설정 캘린더 탭 미연동 분기에 연결 버튼 + 문구 정정

**Files:**
- Modify: `frontend/LittleBoss.jsx` (설정 캘린더 탭 미연동 분기, ~2212–2216행)

- [ ] **Step 1: 미연동 분기 교체**

`frontend/LittleBoss.jsx`에서 아래 블록을:

```jsx
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: C.bg, borderRadius: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 20 }}>📅</span>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>미연동</div><div style={{ fontSize: 12, color: C.textLight }}>Google 로그인 시 캘린더가 자동 연결됩니다.</div></div>
                  </div>
                )}
```

다음으로 교체한다(상태 박스 문구 정정 + 연결 버튼 추가, 프래그먼트로 감쌈):

```jsx
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: C.bg, borderRadius: 10, marginBottom: 16 }}>
                      <span style={{ fontSize: 20 }}>📅</span>
                      <div><div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>미연동</div><div style={{ fontSize: 12, color: C.textLight }}>아래 버튼으로 Google 캘린더를 연결하세요.</div></div>
                    </div>
                    <ConnectGoogleCalendar toast={toast} />
                  </>
                )}
```

`toast`는 `ProfilePage({ toast, onLogout })` 스코프에 있으므로 그대로 전달 가능하다.

- [ ] **Step 2: 빌드로 컴파일 확인**

Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add frontend/LittleBoss.jsx
git commit -m "feat(calendar): 설정 캘린더 탭에 이메일 유저 연결 버튼 추가 + 미연동 문구 정정"
```

---

### Task 4: 자동등록 경로 만료 처리(lazy) + 안내 문구 정정

**Files:**
- Modify: `frontend/LittleBoss.jsx` (자동등록 ~1060–1062행, 안내 문구 ~1067행·~1188행)

- [ ] **Step 1: 자동등록 성공 분기에 만료 감지 추가**

`frontend/LittleBoss.jsx`에서 아래 블록을:

```jsx
          try {
            const { data: cal } = await registerCalendar(data.doc_id, token);
            setCalMsg(cal.success ? `📅 ${cal.message}` : `캘린더 등록 실패: ${cal.message}`);
          } catch (er) {
```

다음으로 교체한다:

```jsx
          try {
            const { data: cal } = await registerCalendar(data.doc_id, token);
            const results = cal.created_events || [];
            const allFailed = results.length > 0 && results.every((r) => r.status !== "created");
            if (allFailed) {
              // 토큰 만료 등으로 전부 실패 → 파일 처리 시점에서만 토큰 정리(lazy)
              localStorage.removeItem("user_token");
              setCalMsg("Google 연결이 만료됐어요. 설정에서 다시 연결해주세요.");
            } else {
              setCalMsg(cal.success ? `📅 ${cal.message}` : `캘린더 등록 실패: ${cal.message}`);
            }
          } catch (er) {
```

- [ ] **Step 2: 자동등록 미연결 안내 문구 정정**

같은 파일에서 아래 줄을:

```jsx
          setCalMsg("ℹ️ Google 로그인하면 일정이 캘린더에 자동 등록됩니다.");
```

다음으로 교체한다:

```jsx
          setCalMsg("ℹ️ 설정에서 Google 캘린더를 연결하면 일정이 자동 등록됩니다.");
```

- [ ] **Step 3: 수동 "다시 등록" 버튼 안내 문구 정정**

같은 파일에서 아래 줄을:

```jsx
                        if (!token) { setCalMsg("ℹ️ Google 로그인하면 일정이 캘린더에 등록됩니다."); return; }
```

다음으로 교체한다:

```jsx
                        if (!token) { setCalMsg("ℹ️ 설정에서 Google 캘린더를 연결하면 일정이 등록됩니다."); return; }
```

> 주의: 만료 정리 로직은 이 수동 버튼에는 넣지 않는다(설계상 파일 처리 시점 한 곳에서만 lazy 처리). 문구만 정정한다.

- [ ] **Step 4: 빌드로 컴파일 확인**

Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
git add frontend/LittleBoss.jsx
git commit -m "feat(calendar): 자동등록 경로에서 만료 토큰 lazy 정리 + 미연결 안내 문구 정정"
```

---

### Task 5: 수동 검증 체크리스트 수행

**Files:** 없음(검증 전용). 프론트 테스트 러너가 없으므로 수동 시나리오로 확인한다.

- [ ] **Step 1: 개발 서버 기동**

Run: `cd frontend && npm run dev`
Expected: Vite dev 서버 기동, 로컬 URL 출력. (`.env`의 `VITE_GOOGLE_CLIENT_ID`, `VITE_API_URL` 필요.)

- [ ] **Step 2: 시나리오 점검 (브라우저)**

다음을 순서대로 확인한다:

1. 이메일로 가입/로그인 → 설정 → **캘린더 연동** 탭에 "Google 캘린더 연결하기" 버튼이 보인다.
2. 버튼 클릭 → Google 동의 → "연동 완료" 표시. **문서 목록이 그대로 유지**되고 프로필 이름/이메일이 안 바뀐다(신원 보존).
3. 설정 → **보안** 탭에 여전히 "비밀번호 변경" UI가 보인다(연결해도 이메일 유저로 인식).
4. 문서 업로드 → 분석 완료 → 일정이 자동 등록되고 "📅 …" 메시지가 뜬다.
5. 설정 → 캘린더 연동 → "연결 해제" → 미연동 상태로 복귀, 연결 버튼 다시 노출.
6. (만료 시뮬레이션) 브라우저 콘솔에서 `localStorage.setItem("user_token","invalid")` 후 파일 업로드 → 자동등록 전부 실패 → "Google 연결이 만료됐어요. 설정에서 다시 연결해주세요." 메시지 + `localStorage.getItem("user_token")`가 제거됨.

- [ ] **Step 3: 결과 기록**

각 항목 통과 여부를 기록한다. 실패 항목이 있으면 해당 Task로 돌아가 수정한다. 통과 시 별도 커밋은 없다(코드 변경 없음).

---

## Self-Review

**1. Spec coverage**
- Route A 클라이언트 access token, user_token만 저장 → Task 1. ✓
- 신원(user_id/email/name) 불변 → Task 1 onSuccess(토큰만 저장). ✓
- 설정 캘린더 탭 미연동에 연결 버튼 + 문구 정정 → Task 3. ✓
- 업로드 결과 화면 문구 정정 → Task 4 Step 2·3. ✓
- 다운스트림(자동등록/재등록/연동표시) 재사용, 백엔드 변경 없음 → 코드 미변경으로 충족. ✓
- 만료 lazy 처리(파일 처리 한 곳, created_events 전부 실패 판정) → Task 4 Step 1. ✓
- GoogleBtn 미수정 → 어떤 Task도 GoogleBtn을 건드리지 않음. ✓
- 빌드 + 수동 체크리스트 검증 → 각 Task Step + Task 5. ✓
- (스펙엔 없지만 기능이 노출시키는 회귀) isEmailUser 교정 → Task 2. 스펙의 "신원 보존" 정신과 정합. ✓

**2. Placeholder scan:** 모든 코드 단계에 실제 코드 포함. TBD/TODO 없음. ✓

**3. Type/이름 일관성:** `ConnectGoogleCalendar`(정의 Task 1 / 사용 Task 3) 이름 일치. `toast` prop 일치. `user_token` 키, `created_events`/`status: "created"` 필드는 백엔드(`action_handler.handle_calendar` / `utils.calendar.create_events`)의 실제 반환 형태와 일치. `isEmailUser`는 단일 사용처(line ~2186)와 정합. ✓
