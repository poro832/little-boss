# 🧊 LittleBoss — AI 행정 비서

> 복잡한 행정 문서를 올리기만 하면 **마감일·필요 서류·일정**을 자동으로 뽑아
> 대시보드와 **Google 캘린더**로 정리해 주는 LLM 기반 문서 자동 분석 서비스.

🔗 **데모:** https://poro832.github.io/little-boss/

> 🏆 **한국인공지능융합기술학회 2026 춘계 학술대회 최우수상**

장학금 공지, 제출 안내문, 행정 공문 같은 문서는 마감과 준비물이 본문에 흩어져 있어 놓치기 쉽습니다.
LittleBoss는 문서를 업로드하면 AI가 핵심 일정과 준비물을 추출해 **D-day·체크리스트·캘린더**로 한눈에 정리합니다.

---

## ✨ 주요 기능

- **문서 업로드 → AI 자동 분석** — PDF·이미지·DOCX·HWPX·TXT 등 업로드(presigned URL로 **S3 직접 업로드**, 최대 50MB) 시 OCR + LLM으로 분석
- **마감일·필요 서류·일정 자동 추출** — 문서 종류, 마감(긴급도), 제출 서류, 캘린더 이벤트를 구조화
- **대시보드** — 마감 임박 문서, D-day, 준비물 달성률을 한 화면에
- **일정 관리** — 월별 캘린더 그리드 + "다가오는 일정"
- **준비물 체크리스트** — 문서별 제출 서류 체크
- **진행/완료 문서 관리** — 체크리스트를 모두 끝내면 **완료 처리**로 '완료된 문서'로 이동(되돌리기 지원)
- **Google 캘린더 자동 등록** — 추출된 일정을 개인 캘린더에 등록(마감 **D-7·D-3·D-1 리마인더** 포함)
- **로그인** — 이메일/비밀번호(보안 해시) 또는 Google 로그인
- **Slack 연동** — Slack 채널에 문서를 올리면 분석 후 개인 캘린더 등록 + 스레드 답글
- **완료 알림 메일** — 분석이 끝나면 가입 이메일로 알림(SNS)

---

## 🔄 동작 흐름

```
업로드 → S3 저장 → (S3 이벤트) → OCR → (이벤트) → AI 분석 → 결과 저장 → 대시보드·캘린더
```

1. **업로드** — 웹앱은 **presigned URL로 파일을 S3에 직접 업로드**(API Gateway 용량 한도 우회, 최대 50MB), Slack은 봇으로 업로드 → S3(`uploads/{doc_id}/{filename}`) + DynamoDB 기록
2. **OCR** — 디지털 PDF는 텍스트 레이어 추출, 스캔본은 Amazon Textract, DOCX/HWPX는 파서로 텍스트화
3. **AI 분석** — Amazon Bedrock(Claude)로 마감일·필요 서류·일정·요약 추출
4. **정리** — 결과를 대시보드에 표시하고, 연결돼 있으면 Google 캘린더에 자동 등록

상태 흐름: `uploaded → ocr_done → done` (실패 시 `error`). 무거운 분석은 **비동기 이벤트 파이프라인**으로 처리됩니다.

---

## 🏗️ 아키텍처

```
[React + Vite / GitHub Pages]
            │  HTTPS
            ▼
     [API Gateway]
            │
            ▼
   [AWS Lambda · Python 3.11]
   upload · ocr · ai-analyzer · action · slack · google-oauth
        │        │         │
        ▼        ▼         ▼
     [S3]   [DynamoDB]  [Bedrock · Textract · SNS]
```

- **서버리스**, 리전 `ap-northeast-2`
- 프론트는 정적 호스팅(GitHub Pages), 백엔드는 Lambda + API Gateway
- 데이터는 DynamoDB 2개 테이블(문서 / 유저·매핑·멱등마커) — 스키마: [`docs/dynamodb-schema.md`](docs/dynamodb-schema.md)

---

## 🛠️ 기술 스택

| 구분 | 사용 기술 |
|---|---|
| **Frontend** | React 18, Vite, axios, `@react-oauth/google` |
| **Backend** | Python 3.11 (AWS Lambda · stdlib + boto3) |
| **AWS** | API Gateway, DynamoDB, S3, Amazon Bedrock(Claude), Amazon Textract, SNS |
| **인증/보안** | PBKDF2-HMAC-SHA256 + KMS 페퍼 해시, Google OAuth 2.0 |
| **연동** | Slack Events API, Google Calendar API |

---

## 💻 로컬 실행

### 프론트엔드
```bash
cd frontend
npm install
npm run dev
```
환경변수(`frontend/.env`):
```
VITE_API_URL=<API Gateway base URL>
VITE_GOOGLE_CLIENT_ID=<Google OAuth Client ID>
```

### 백엔드 (로컬 개발 서버)
```bash
cd backend
pip install -r requirements.txt
python local_server.py     # ENV=local 이면 DynamoDB 대신 backend/local_db/*.json 사용
```
> 로컬 모드는 AWS 없이 같은 스키마를 파일로 시뮬레이션합니다.

---

## 📁 프로젝트 구조

```
frontend/                React + Vite 웹앱 (단일 페이지 대시보드)
backend/
  handlers/              Lambda 핸들러 (upload · ocr · ai · action · slack · google-oauth · auth)
  utils/                 storage · ai · ocr · calendar · slack* · pepper · notify_email
  models/                Document / 분석 결과 데이터 모델
  local_server.py        로컬 개발용 Flask 서버
docs/                    설계 문서 · DynamoDB 스키마
```

---

## 🤝 Slack 연동

Slack 채널에 문서를 올리면:
1. 봇이 분석을 시작하고, Google 캘린더 미연결이면 **연결 링크**를 안내
2. 분석이 끝나면 스레드에 **요약(마감·필요서류)** + 개인 캘린더 등록 결과를 답글
3. 캘린더 연결이 만료되면 **재연동 링크**를 자동 안내

---

> 🎓 대학 캡스톤 프로젝트 — *마이리틀테리팀(5팀)*
