# 프로젝트 계획서: 내 손안의 행정 비서 (LittleBoss)

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | LittleBoss - 내 손안의 행정 비서 |
| 유형 | Document-to-Action AI 서비스 |
| 핵심 가치 | 서류 분석 → 자동 일정 등록 + 준비물 체크리스트 생성 |
| 주요 대상 | 대학생 (장학금, 인턴십, 수강신청 등 행정 서류가 많은 계층) |

### 핵심 시나리오
> 사용자가 장학금 공지 PDF 또는 인턴십 제출 서류 사진을 업로드하면,
> AI가 마감일을 계산해 **Google Calendar에 자동 등록**하고 **부족한 서류 목록**을 알려준다.

---

## 2. 차별점 (경쟁 서비스 비교)

### 기존 서비스 한계

| 서비스 | 한계 |
|--------|------|
| ChatGPT / Claude | 문서 요약은 되지만 **액션 없음** (캘린더 등록 불가) |
| Google Assistant | 일정 등록은 되지만 **서류 분석 불가** |
| 일반 OCR 앱 | 텍스트 추출만, **해석/행동 없음** |
| 네이버 클로바 | OCR 특화지만 **자동 액션 연결 없음** |
| Notion AI | 문서 정리는 되지만 **외부 캘린더 연동 없음** |

### 핵심 차별점

1. **"읽기"가 아닌 "행동"**
   - 기존: 서류 내용을 알려줌
   - LittleBoss: 서류를 보고 **직접 캘린더에 등록하고 알림까지 설정**

2. **한국 행정 서류 특화**
   - 장학금 공지, 인턴십 제출 양식, 학교 공문 등 **한국 대학생 맥락에 최적화된 AI 분석**

3. **준비물 부족 알림**
   - 단순 마감일 등록이 아니라 **"이 서류 아직 없어요"** 까지 체크

4. **원스톱 플로우**
   - 업로드 한 번 → OCR → AI 분석 → 캘린더 등록 → 알림 설정까지 **자동 완결**

### 한 줄 차별점 요약

> **"AI가 서류를 읽고, 대신 움직여준다"**
> 기존 서비스가 "요약"에서 멈출 때, LittleBoss는 "실행"까지 한다.

---

## 3. 기술 스택

### 프론트엔드
| 기술 | 버전 | 역할 |
|------|------|------|
| **React** | 18.2.0 | UI 라이브러리 |
| **React DOM** | 18.2.0 | React 렌더링 |
| **React Router DOM** | 6.28.0 | 클라이언트 라우팅 |
| **Axios** | 1.13.6 | HTTP 통신 (백엔드 API 호출) |
| **React Dropzone** | 15.0.0 | 파일 드래그앤드롭 업로드 |
| **React Scripts (CRA)** | 5.0.1 | 빌드 도구 (Webpack, Babel 등) |
| **@testing-library/react** | 14.1.2 | 컴포넌트 테스트 |

### 백엔드
| 기술 | 버전 | 역할 |
|------|------|------|
| **Python** | 3.11 | 런타임 |
| **Flask** | 3.0.3 | 로컬 개발 서버 (배포 시 Lambda로 전환) |
| **Flask-CORS** | 4.0.1 | 프론트엔드 CORS 허용 |
| **python-dotenv** | 1.0.1 | 환경변수 관리 (.env) |
| **google-generativeai** | 0.7.2 | Gemini AI API (로컬 개발용) |
| **boto3** | 1.34.0 | AWS SDK (S3, DynamoDB, Textract 등) |
| **PyMuPDF** | 1.24.5 | PDF 텍스트 추출 (로컬 OCR) |
| **Pillow** | 10.4.0 | 이미지 처리/전처리 |
| **requests** | 2.32.3 | HTTP 요청 |

### AWS 클라우드 서비스
| 서비스 | 역할 |
|--------|------|
| **Amazon Textract** | PDF/이미지에서 텍스트, 표, 폼 데이터 추출 |
| **AWS Lambda** | 서버리스 백엔드 (Python 3.11 런타임), 이벤트 드리븐 비동기 처리 |
| **Amazon S3** | 업로드 서류 임시 저장 + 프론트엔드 정적 호스팅 + Lambda 트리거 |
| **Amazon API Gateway** | 프론트엔드 ↔ Lambda REST API 연결 |
| **Amazon DynamoDB** | 사용자별 처리 내역 및 체크리스트 저장 + Streams로 Lambda 트리거 |
| **Amazon SNS** | 마감 알림 이메일 발송 (이메일 구독) |

### 외부 연동
| 서비스 | 역할 |
|--------|------|
| **Google Gemini API** | AI 서류 분석 (google-generativeai 0.7.2) |
| **Google Calendar API** | 일정 자동 등록 |
| **Google OAuth 2.0** | 사용자 인증 |

---

## 4. 시스템 아키텍처 (비동기 이벤트 드리븐)

### 전체 흐름
```
[사용자]
   │ 서류 업로드 (PDF/이미지)
   ▼
[Frontend - React]
   │ POST /upload
   ▼
[API Gateway]
   │
   ▼
[Lambda: Upload Handler]
   │ 1. 파일을 S3에 저장
   │ 2. DynamoDB 상태: "uploaded"
   │ 3. 즉시 응답 → { doc_id, status: "uploaded" }
   │
   ▼ (S3 이벤트 트리거 - 비동기)
[Lambda: OCR Handler]
   │ 1. Textract 호출
   │ 2. OCR 결과를 S3에 저장
   │ 3. DynamoDB 상태: "ocr_done"
   │
   ▼ (DynamoDB Streams 트리거 - 비동기)
[Lambda: AI Analyzer]
   │ 1. OCR 결과 읽기
   │ 2. Gemini API 호출 → 마감일, 준비물, 액션 추출
   │ 3. 분석 결과를 DynamoDB에 저장
   │ 4. DynamoDB 상태: "done"
   │
   ▼ (사용자가 "캘린더 등록" 클릭 시 - API Gateway)
[Lambda: Action Executor]
   │ ├─ Google Calendar API → 일정 등록
   │ ├─ DynamoDB → 체크리스트 저장
   │ └─ SNS → 알림 설정

[Frontend] ← GET /documents/{doc_id} 폴링으로 상태 확인
```

### 상태 흐름 (DynamoDB status 필드)
```
uploaded → ocr_processing → ocr_done → analyzing → done
                                                     ↘ error (실패 시)
```

### 프론트엔드 폴링 방식
```
1. POST /upload → 즉시 doc_id 받음
2. 로딩 화면 표시
3. GET /documents/{doc_id} 를 3초 간격으로 폴링
4. status가 "done"이 되면 분석 결과 화면으로 전환
5. status가 "error"이면 에러 메시지 표시
```

---

## 5. 핵심 기능 명세

### 6.1 서류 업로드 (Upload Handler)
- 지원 포맷: PDF, JPG, PNG, HEIC
- S3에 파일 저장 후 **즉시 doc_id 반환** (비동기 처리 시작)
- DynamoDB에 문서 레코드 생성 (status: "uploaded")

### 6.2 OCR 처리 (OCR Handler) - 비동기
- **S3 이벤트 트리거**로 자동 실행 (업로드 완료 시)
- Textract의 `AnalyzeDocument` API 사용 (표 및 폼 데이터 포함)
- 다국어 지원: 한국어 기본
- OCR 결과를 S3에 저장, DynamoDB 상태 업데이트 (status: "ocr_done")

### 6.3 AI 분석 엔진 (AI Analyzer) - 비동기
- **DynamoDB Streams 트리거**로 자동 실행 (status가 "ocr_done"으로 변경 시)
- Gemini API에 전달할 프롬프트 구조:
```
당신은 행정 서류 분석 전문가입니다.
다음 서류 내용을 분석하여 JSON 형식으로 반환하세요:
- document_type: 서류 종류
- deadlines: [{ date, description, urgency }]
- required_documents: [{ name, description, have }]
- action_items: [{ action, due_date, priority }]
- calendar_events: [{ title, date, time, location, description }]
```
- 분석 결과를 DynamoDB에 저장, 상태 업데이트 (status: "done")

### 6.4 Google Calendar 자동 등록 (Action Executor)
- **사용자가 프론트엔드에서 "캘린더 등록" 버튼 클릭 시** API 호출
- OAuth 2.0 토큰 관리 (Lambda 환경변수에 저장)
- 이벤트 생성: 마감일 D-7, D-3, D-1 리마인더 자동 설정
- 색상 코딩: 긴급도에 따라 캘린더 이벤트 색상 구분

### 6.5 준비물 체크리스트
- DynamoDB에 저장, 프론트에서 실시간 체크/완료 처리
- 부족한 서류 강조 표시

### 6.6 알림 시스템
- 마감일 기반 자동 알림 (SNS → 이메일/SMS)
- 사용자 설정 가능 (D-n일 전 알림)

### 6.7 상태 조회 API (프론트엔드 폴링)
- GET /documents/{doc_id} → 현재 처리 상태 + 분석 결과 반환
- 프론트엔드에서 3초 간격 폴링으로 진행 상태 표시

---

## 6. 개발 단계 (로드맵)

### Phase 1 - 기반 구축 (2주)
- [ ] AWS IAM 역할 설정
- [ ] S3 버킷 생성 + 이벤트 알림 설정 (→ OCR Lambda 트리거)
- [ ] DynamoDB 테이블 생성 + Streams 활성화
- [ ] Upload Handler Lambda 구현 (S3 저장 + 즉시 응답)
- [ ] API Gateway 설정 (POST /upload, GET /documents/{doc_id})

### Phase 2 - 비동기 파이프라인 구축 (2주)
- [ ] OCR Handler Lambda 구현 (S3 트리거 → Textract → 결과 저장)
- [ ] AI Analyzer Lambda 구현 (DynamoDB Streams 트리거 → Gemini API)
- [ ] 프롬프트 엔지니어링 (장학금, 인턴십, 공문 등 유형별)
- [ ] 파이프라인 전체 테스트 (업로드 → OCR → 분석 자동 완결)

### Phase 3 - Google Calendar 연동 (1주)
- [ ] Google OAuth 2.0 구현
- [ ] Lambda 환경변수에 토큰 설정
- [ ] Action Executor Lambda (Calendar 이벤트 생성)
- [ ] 리마인더 설정 테스트

### Phase 4 - 프론트엔드 개발 (2주)
- [ ] React 프로젝트 세팅
- [ ] 파일 업로드 UI + 상태 폴링 로직
- [ ] 분석 중 로딩/진행률 화면
- [ ] 분석 결과 표시 화면 (체크리스트, 캘린더 미리보기)
- [ ] Google 로그인 OAuth 플로우
- [ ] 반응형 디자인 (모바일 지원)

### Phase 5 - 알림 시스템 & 통합 테스트 (1주)
- [ ] SNS 알림 Lambda
- [ ] 마감일 스케줄러 (EventBridge Scheduler)
- [ ] End-to-End 비동기 파이프라인 통합 테스트
- [ ] 에러 핸들링 (각 단계 실패 시 status: "error" 처리)
- [ ] 버그 수정 및 UX 개선

### Phase 6 - 배포 및 발표 준비 (1주)
- [ ] 프로덕션 배포 (S3 정적 웹사이트 호스팅)
- [ ] 데모 시나리오 준비
- [ ] 발표 자료 작성

**총 예상 기간: 9주**

---

## 7. 디렉토리 구조 (예상)

```
littleboss/
├── frontend/                  # React 앱
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileUpload.jsx
│   │   │   ├── CheckList.jsx
│   │   │   └── CalendarPreview.jsx
│   │   ├── pages/
│   │   └── App.jsx
│   └── package.json
│
├── backend/                   # Lambda 함수들
│   ├── upload-handler/        # S3 업로드 + 상태 조회
│   │   └── lambda_function.py
│   ├── ocr-handler/           # Textract OCR (S3 트리거)
│   │   └── lambda_function.py
│   ├── ai-analyzer/           # Gemini API 분석 (DynamoDB Streams 트리거)
│   │   └── lambda_function.py
│   ├── action-executor/       # Calendar, 체크리스트, 알림
│   │   └── lambda_function.py
│   └── requirements.txt
│
├── infrastructure/            # IaC (선택: SAM or CDK)
│   ├── template.yaml          # AWS SAM
│   └── ...
│
└── PROJECT_PLAN.md
```

---

## 8. DynamoDB 스키마

### littleboss-users 테이블
| 필드 | 타입 | 설명 |
|------|------|------|
| user_id (PK) | String | Google OAuth sub |
| email | String | 이메일 |
| google_calendar_token | String | 암호화된 OAuth 토큰 |
| created_at | String | ISO 8601 |

### littleboss-documents 테이블
| 필드 | 타입 | 설명 |
|------|------|------|
| doc_id (PK) | String | UUID |
| user_id (SK) | String | 사용자 ID |
| s3_key | String | S3 원본 파일 경로 |
| ocr_result_key | String | S3 OCR 결과 경로 |
| status | String | uploaded / ocr_done / ai_processing / done / error |
| analysis_result | Map | Gemini 분석 JSON |
| error_message | String | 실패 시 에러 내용 |
| created_at | String | ISO 8601 |
| updated_at | String | ISO 8601 (상태 변경 시 갱신) |
| **DynamoDB Streams** | - | **활성화 (새 이미지, NEW_IMAGE)** — AI Analyzer 자동 트리거 |

#### GSI
| 인덱스 이름 | 파티션 키 | 용도 |
|-------------|----------|------|
| `user_id-index` | `user_id` (String) | 사용자별 문서 목록 조회 |

### littleboss-checklists 테이블
| 필드 | 타입 | 설명 |
|------|------|------|
| checklist_id (PK) | String | UUID |
| doc_id | String | 원본 문서 ID |
| user_id | String | 사용자 ID |
| items | List | [{ name, completed, due_date }] |

#### GSI
| 인덱스 이름 | 파티션 키 | 용도 |
|-------------|----------|------|
| `doc_id-index` | `doc_id` (String) | 문서별 체크리스트 조회 |

---

## 9. 비용 예상 (AWS Free Tier 기준)

| 서비스 | Free Tier | 초과 예상 비용 |
|--------|-----------|---------------|
| Textract | 1,000페이지/월 무료 | $1.5/1,000페이지 |
| Gemini API | 무료 티어 (분당 15회) | 유료 시 $0.075/1M tokens (Flash) |
| Lambda | 1M 요청/월 무료 | 거의 무료 |
| S3 | 5GB 무료 | $0.023/GB |
| DynamoDB | 25GB 무료 | 거의 무료 |
| API Gateway | 1M 요청/월 무료 | $3.5/1M 요청 |

**개발/테스트 단계 예상 비용: 월 $5~$15 이내**

---

## 10. 주요 리스크 및 대응 방안

| 리스크 | 대응 방안 |
|--------|----------|
| 한국어 서류 OCR 정확도 낮음 | Textract + 전처리(이미지 보정) 조합, 수동 수정 UI 제공 |
| Google Calendar OAuth 복잡성 | Refresh Token을 Lambda 환경변수에 저장, 토큰 갱신 자동화 |
| Gemini 응답 JSON 파싱 실패 | 응답 스키마 검증 레이어 추가, 재시도 로직 |
| Lambda 콜드 스타트 지연 | Provisioned Concurrency 또는 Warm-up 전략 |
| 개인정보 (서류 내용) 보안 | S3 암호화, 처리 후 원본 자동 삭제 옵션 |

---

## 11. 발표 데모 시나리오

1. 장학금 공지 PDF 업로드
2. Textract OCR 처리 진행 표시 (로딩)
3. 분석 결과 화면:
   - 마감일: 2026년 3월 31일 (D-21)
   - 캘린더 등록 버튼 클릭
   - Google Calendar에 자동 등록 완료
4. 준비물 체크리스트:
   - ✅ 성적증명서
   - ☐ 재학증명서 (미보유 - 강조)
   - ☐ 가족관계증명서 (미보유 - 강조)
5. 알림 설정 확인 (D-7, D-3, D-1)
