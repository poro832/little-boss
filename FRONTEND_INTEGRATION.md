# LittleBoss 프론트엔드 연동 가이드

> 업데이트: 2026-04-28
> 백엔드 담당이 작성, 프론트엔드 팀원용

---

## API Base URL

```
https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod
```

모든 엔드포인트 앞에 이 URL을 붙여서 호출합니다. CORS는 `*`로 허용되어 있어 별도 설정 불필요.

---

## 엔드포인트 명세

### 1. 헬스체크
```
GET /health
```
**응답:**
```json
{"status": "ok", "env": "production"}
```

---

### 2. 파일 업로드
```
POST /upload
Content-Type: multipart/form-data
```
**Body (FormData):**
- `file`: PDF/이미지 파일 (필수, 최대 10MB)
- `user_id`: Google sub ID (없으면 "anonymous")

**응답:**
```json
{
  "success": true,
  "doc_id": "7c0fb3f9-ad76-40a2-9392-376cd63ef141",
  "filename": "장학금공지.pdf",
  "status": "uploaded",
  "message": "업로드 완료. 분석을 시작합니다."
}
```

업로드 후 **`doc_id`로 폴링**하여 분석 완료를 기다립니다.

---

### 3. 문서 상태 조회 (폴링)
```
GET /documents/{doc_id}
```
**응답:**
```json
{
  "success": true,
  "document": {
    "doc_id": "7c0fb3f9-...",
    "filename": "장학금공지.pdf",
    "status": "done",
    "analysis": {
      "document_type": "장학금 공지",
      "summary": "...",
      "deadlines": [{"date": "2026-05-15", "description": "...", "urgency": "high"}],
      "required_documents": [{"name": "성적증명서", "have": false}],
      "calendar_events": [{"title": "...", "date": "...", "time": "23:59"}]
    }
  }
}
```

**status 상태값:**
- `uploaded` → 업로드 완료
- `ocr_processing` → OCR 진행 중
- `ocr_done` → OCR 완료
- `ai_processing` → AI 분석 중
- `done` → 완료 (analysis 필드 사용 가능)
- `error` → 실패

**권장**: 3초 간격 폴링, `done` 또는 `error`까지 반복.

---

### 4. 사용자 문서 목록
```
GET /documents?user_id={user_id}
```
**응답:**
```json
{"success": true, "documents": [...]}
```

---

### 5. 캘린더 등록
```
POST /calendar/{doc_id}
Content-Type: application/json
```
**Body:**
```json
{
  "user_token": "ya29.xxx..."
}
```
**`user_token`은 Google OAuth로 받은 access_token** (scope: `calendar.events`)

**응답:**
```json
{
  "success": true,
  "message": "5개 일정이 캘린더에 등록되었습니다.",
  "created_events": [
    {"title": "...", "id": "google_event_id", "link": "https://calendar.google.com/...", "status": "created"}
  ],
  "count": 5
}
```

토큰 없이 호출하면 등록 예정 이벤트 목록만 반환 (실제 등록 안 됨).

---

### 6. 체크리스트 조회
```
GET /checklist/{doc_id}
```
**응답:**
```json
{
  "success": true,
  "checklist": [
    {"name": "성적증명서", "description": "...", "completed": false}
  ],
  "total": 3,
  "completed": 1
}
```

---

### 7. 체크리스트 항목 업데이트
```
PATCH /checklist/{doc_id}
Content-Type: application/json
```
**Body:**
```json
{
  "name": "성적증명서",
  "completed": true
}
```

---

## Google OAuth 흐름 (프론트엔드 구현)

### 필요한 정보
- **Client ID**: `889650272637-a0dfrs6froqhnkbchso0hjcq544u442d.apps.googleusercontent.com`
- **Redirect URI**: `http://localhost:3000/oauth/callback`
- **Scopes**:
  - `openid email profile`
  - `https://www.googleapis.com/auth/calendar.events`

### 권장 라이브러리
- React: `@react-oauth/google` 또는 `gapi-script`
- Vue: `vue3-google-oauth2`

### 흐름
```
1. 사용자 "Google 로그인" 클릭
   ↓
2. Google OAuth 화면 → 권한 동의
   ↓
3. access_token + id_token 받음
   ↓
4. id_token 디코드 → sub 필드가 user_id로 사용
   ↓
5. 백엔드 API 호출 시:
   - 파일 업로드: user_id 전달
   - 캘린더 등록: user_token (access_token) 전달
```

### 예시 코드 (React, @react-oauth/google)
```jsx
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

function App() {
  const login = useGoogleLogin({
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
    onSuccess: (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      // 사용자 정보 조회
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.json()).then(user => {
        localStorage.setItem('user_id', user.sub);
        localStorage.setItem('user_token', accessToken);
      });
    }
  });
  return <button onClick={() => login()}>Google 로그인</button>;
}
```

---

## 테스트 사용자

OAuth 동의 화면이 "테스트 중" 상태이므로 등록된 Gmail만 로그인 가능:
- `ldd826@gmail.com`

다른 이메일 추가 필요 시 백엔드 담당에게 요청.

---

## 폴링 예시 (JavaScript)

```javascript
async function pollDocument(docId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${API_URL}/documents/${docId}`);
    const data = await res.json();
    if (data.document?.status === 'done') return data.document;
    if (data.document?.status === 'error') throw new Error('분석 실패');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('타임아웃');
}
```

---

## 알려진 제약

- Lambda 콜드 스타트로 첫 호출 2~5초 지연 가능
- `done` 상태까지 평균 15~30초 (PDF 크기에 따라)
- 현재 DynamoDB Streams 권한 이슈로 자동 AI 분석 미동작 (해결 진행 중)

---

## 문의

백엔드 코드: https://github.com/poro832/little-boss
