# LittleBoss 프론트엔드 설정 가이드

> 프론트엔드 팀원 작업용
> 스택: React 18 + Vite
> 위치: `frontend2/littleboss/frontend/`

---

## 1. 패키지 설치

프로젝트 디렉토리에서:

```bash
cd frontend2/littleboss/frontend
npm install @react-oauth/google axios jwt-decode
```

`package.json`이 자동 업데이트됩니다.

---

## 2. 환경변수 설정

`frontend2/littleboss/frontend/` 폴더에 **`.env`** 파일 생성:

```env
VITE_API_URL=https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod
VITE_GOOGLE_CLIENT_ID=889650272637-a0dfrs6froqhnkbchso0hjcq544u442d.apps.googleusercontent.com
```

> Vite는 `VITE_` 접두사가 붙은 환경변수만 클라이언트에 노출합니다.
> `.env`는 절대 git 커밋 금지 (`.gitignore`에 추가)

---

## 3. `main.jsx`에 OAuth Provider 감싸기

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import LittleBoss from './LittleBoss'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <LittleBoss />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
```

---

## 4. API 클라이언트 만들기

`frontend2/littleboss/frontend/api.js` 신규 파일:

```javascript
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
})

// 헬스 체크
export const checkHealth = () => api.get('/health')

// 파일 업로드
export const uploadFile = (file, userId) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('user_id', userId)
  return api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// 문서 상태 조회 (폴링용)
export const getDocument = (docId) => api.get(`/documents/${docId}`)

// 문서 목록
export const listDocuments = (userId) =>
  api.get('/documents', { params: { user_id: userId } })

// 캘린더 등록 (Google access_token 필요)
export const registerCalendar = (docId, userToken) =>
  api.post(`/calendar/${docId}`, { user_token: userToken })

// 체크리스트
export const getChecklist = (docId) => api.get(`/checklist/${docId}`)
export const updateChecklistItem = (docId, name, completed) =>
  api.patch(`/checklist/${docId}`, { name, completed })

export default api
```

---

## 5. Google 로그인 구현

`LittleBoss.jsx`의 `GoogleBtn` 컴포넌트를 실제 OAuth와 연결:

```jsx
import { useGoogleLogin } from '@react-oauth/google'
import { jwtDecode } from 'jwt-decode'

function GoogleBtn({ label, onLogin }) {
  const login = useGoogleLogin({
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token

      // 사용자 정보 조회
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const user = await res.json()

      // 로컬 저장
      localStorage.setItem('user_id', user.sub)
      localStorage.setItem('user_email', user.email)
      localStorage.setItem('user_name', user.name)
      localStorage.setItem('user_token', accessToken)

      onLogin?.(user)
    },
    onError: () => alert('로그인 실패')
  })

  return (
    <button onClick={() => login()} style={{ /* 기존 스타일 */ }}>
      <GoogleIcon /> {label}
    </button>
  )
}
```

---

## 6. 파일 업로드 + 분석 폴링

업로드 버튼 핸들러:

```jsx
import { uploadFile, getDocument } from './api'

async function handleUpload(file) {
  const userId = localStorage.getItem('user_id') || 'anonymous'

  try {
    // 1. 업로드
    const { data: uploadRes } = await uploadFile(file, userId)
    if (!uploadRes.success) throw new Error(uploadRes.message)

    const docId = uploadRes.doc_id
    setStatus('분석 중...')

    // 2. 폴링 (3초 간격, 최대 5분)
    for (let i = 0; i < 100; i++) {
      const { data } = await getDocument(docId)
      const doc = data.document

      if (doc.status === 'done') {
        setAnalysisResult(doc.analysis)
        setStatus('완료')
        return
      }
      if (doc.status === 'error') throw new Error('분석 실패')

      setStatus(`진행 중: ${doc.status}`)
      await new Promise(r => setTimeout(r, 3000))
    }

    throw new Error('시간 초과')
  } catch (e) {
    alert(e.message)
  }
}
```

---

## 7. 분석 결과 표시

```jsx
function AnalysisResult({ analysis }) {
  return (
    <div>
      <h3>{analysis.document_type}</h3>
      <p>{analysis.summary}</p>

      <h4>마감일</h4>
      {analysis.deadlines.map((d, i) => (
        <div key={i}>
          {d.date} - {d.description} ({d.urgency})
        </div>
      ))}

      <h4>준비물</h4>
      {analysis.required_documents.map((d, i) => (
        <label key={i}>
          <input type="checkbox" /> {d.name}: {d.description}
        </label>
      ))}
    </div>
  )
}
```

---

## 8. 캘린더 등록 버튼

```jsx
import { registerCalendar } from './api'

async function handleAddToCalendar(docId) {
  const userToken = localStorage.getItem('user_token')
  if (!userToken) {
    alert('Google 로그인이 필요합니다')
    return
  }

  try {
    const { data } = await registerCalendar(docId, userToken)
    alert(`${data.count}개 일정이 캘린더에 등록되었습니다!`)
  } catch (e) {
    alert('캘린더 등록 실패: ' + e.message)
  }
}
```

---

## 9. 실행 및 테스트

```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

**테스트 순서:**
1. Google 로그인 버튼 클릭 → `ldd826@gmail.com`로 로그인 (테스트 사용자 등록된 계정만 가능)
2. 파일 업로드 → `doc_id` 받기 + 폴링 시작
3. 분석 완료 후 결과 확인
4. "캘린더 등록" 버튼 → 본인 Google 캘린더에 이벤트 추가 확인

---

## 자주 발생하는 이슈

| 증상 | 원인 | 해결 |
|------|------|------|
| `CORS error` | API URL 잘못 입력 | `.env`의 `VITE_API_URL` 확인 |
| `Access blocked` (로그인 시) | 테스트 사용자 미등록 | 백엔드 담당에게 본인 Gmail 추가 요청 |
| 폴링 영원히 안 끝남 | `done`까지 보통 15~30초, 5분 넘으면 백엔드 문제 | 백엔드 담당에게 문의 |
| `Network Error` | 백엔드 서비스 다운 가능 | `/health` 직접 호출해보기 |

---

## 백엔드 정보 참고

| 항목 | 값 |
|------|-----|
| API URL | `https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod` |
| OAuth Client ID | `889650272637-a0dfrs6froqhnkbchso0hjcq544u442d.apps.googleusercontent.com` |
| 테스트 사용자 | `ldd826@gmail.com` |
| 백엔드 리포 | https://github.com/poro832/little-boss |

상세 API 명세는 `FRONTEND_INTEGRATION.md` 참고.

---

## 체크리스트

```
[ ] npm install (@react-oauth/google, axios, jwt-decode)
[ ] .env 파일 생성 (VITE_API_URL, VITE_GOOGLE_CLIENT_ID)
[ ] main.jsx에 GoogleOAuthProvider 추가
[ ] api.js 작성
[ ] GoogleBtn 컴포넌트에 실제 OAuth 연결
[ ] 파일 업로드 핸들러에 uploadFile + 폴링 연결
[ ] 분석 결과 화면 데이터 바인딩
[ ] "캘린더 등록" 버튼에 registerCalendar 연결
[ ] 체크리스트 화면 getChecklist + updateChecklistItem 연결
[ ] 로컬에서 E2E 테스트
```
