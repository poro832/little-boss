# LittleBoss 개발 환경 설정

## 현재 상태
- 백엔드 베이스 구조 완성 (Flask 로컬 서버 정상 동작 확인)
- 프론트엔드 미구현

---

## 백엔드 설정

### 기술 스택
- Python 3.11
- Flask (로컬 테스트 서버)
- AWS Lambda (배포 시 전환)

### 로컬 실행 방법

```bash
cd backend

# 패키지 설치
pip install -r requirements.txt

# .env 파일 생성
cp .env.example .env
# .env 파일 열어서 API 키 입력

# 서버 실행
python local_server.py
# -> http://localhost:5000
```

### .env 설정 항목

```
AI_PROVIDER=gemini           # Gemini API 사용
GEMINI_API_KEY=여기에_입력    # Google AI Studio에서 발급
ENV=local
```

> ⚠️ AWS CLI 키(Access Key)는 발급하지 않습니다. 콘솔의 CloudShell이나 EC2 인스턴스에 IAM Role을 부여하여 사용합니다.

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | /health | 서버 상태 확인 |
| POST | /process | 파일 업로드 + OCR + AI 분석 한번에 |
| POST | /upload | 파일 업로드만 |
| POST | /ocr/{doc_id} | OCR만 |
| POST | /analyze/{doc_id} | AI 분석만 |
| GET | /documents | 문서 목록 |
| GET | /documents/{doc_id} | 문서 상세 조회 |
| POST | /calendar/{doc_id} | 캘린더 등록 |
| GET | /checklist/{doc_id} | 체크리스트 조회 |
| PATCH | /checklist/{doc_id} | 체크 완료 처리 |

### 파일 구조

```
backend/
├── handlers/
│   ├── upload_handler.py   # 파일 업로드
│   ├── ocr_handler.py      # 텍스트 추출
│   ├── ai_handler.py       # AI 분석
│   └── action_handler.py   # 캘린더/체크리스트
├── utils/
│   ├── storage.py          # 로컬 JSON <-> AWS S3/DynamoDB
│   ├── ocr.py              # PyMuPDF <-> Amazon Textract
│   └── ai.py               # Gemini <-> Claude
├── models/
│   └── document.py         # 데이터 모델
├── tests/
│   └── test_pipeline.py
├── local_server.py
├── requirements.txt
└── .env.example
```

### AWS 전환 방법 (계정 수령 후)

| 파일 | 변경 내용 |
|------|----------|
| `utils/storage.py` | 주석 처리된 S3/DynamoDB 코드 해제 |
| `utils/ocr.py` | 주석 처리된 Textract 코드 해제 |
| `.env` | `ENV=production`, 버킷명 입력 |
| `local_server.py` | Lambda 핸들러 형식으로 변환 |

---

## 프론트엔드 설정

### 기술 스택
- React.js (웹)
- React Native (앱, 발표 이후)

### 초기 세팅

```bash
# 프로젝트 루트에서 실행
npx create-react-app frontend
cd frontend
npm install axios react-dropzone
npm start
# -> http://localhost:3000
```

### 화면 구성

```
frontend/src/
├── pages/
│   ├── Home.jsx            # 메인 (파일 업로드)
│   ├── Loading.jsx         # 분석 중 로딩
│   ├── Result.jsx          # 분석 결과
│   └── History.jsx         # 처리 내역
├── components/
│   ├── FileDropzone.jsx    # 드래그앤드롭 업로드
│   ├── DeadlineCard.jsx    # 마감일 카드
│   ├── CheckList.jsx       # 준비물 체크리스트
│   └── CalendarButton.jsx  # 캘린더 등록 버튼
├── api/
│   └── index.js            # 백엔드 API 호출 함수
└── App.jsx
```

### 개발 순서

1. **FileDropzone** - 파일 업로드 UI
2. **Loading** - 분석 중 진행 상태 표시
3. **Result** - 마감일 카드 + 체크리스트 + 캘린더 버튼
4. **API 연동** - 백엔드 `/process` 호출
5. **Google OAuth** - 로그인 연동
6. **History** - 처리 내역 페이지

### 백엔드 연동 설정

```js
// frontend/src/api/index.js
const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
```

```
# frontend/.env
REACT_APP_API_URL=http://localhost:5000   # 로컬
# REACT_APP_API_URL=https://xxx.execute-api.ap-northeast-2.amazonaws.com  # 배포 후
```

---

## 전체 실행 순서 (로컬 개발)

```bash
# 터미널 1 - 백엔드
cd backend
python local_server.py

# 터미널 2 - 프론트엔드
cd frontend
npm start
```

---

## 다음 할 일

- [x] 백엔드 베이스 구조 완성
- [x] 로컬 서버 실행 확인
- [ ] Gemini API 키로 실제 서류 분석 테스트
- [ ] React 프론트엔드 초기 세팅
- [ ] FileDropzone 컴포넌트 구현
- [ ] 백엔드-프론트 연동 테스트
- [ ] AWS 계정 수령 후 클라우드 전환
