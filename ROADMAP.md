# LittleBoss 개발 로드맵

## 전체 흐름

```
AWS 계정 수령
    ↓
환경 세팅
    ↓
백엔드 (AWS)
    ↓
AI 연동 (Gemini / Claude)
    ↓
프론트엔드 (React 웹)
    ↓
통합 테스트
    ↓
배포
    ↓
[발표]
    ↓
앱 (React Native)
```

---

## STEP 1. AWS 계정 초기 세팅 (1~2일)

- [ ] IAM 역할 생성: `littleboss-lambda-role` (root 계정 직접 사용 금지)
- [ ] IAM 인라인 정책 설정 (구체적 액션만 명시, FullAccess 사용 금지)
  - S3: GetObject, PutObject, ListBucket (littleboss-documents 버킷 한정)
  - Textract: AnalyzeDocument, StartDocumentAnalysis, GetDocumentAnalysis
  - Lambda: 실행 역할로 처리 (별도 사용자 권한 불필요)
  - DynamoDB: PutItem, GetItem, UpdateItem, Query, Scan (littleboss-* 테이블 한정)
  - API Gateway: 콘솔에서 설정 (별도 사용자 권한 불필요)
  - SNS: Publish, Subscribe (littleboss-* 토픽 한정)
  - CloudWatch Logs: CreateLogGroup, CreateLogStream, PutLogEvents
- [ ] 콘솔 접속 후 CloudShell 또는 EC2에서 IAM Role 기반으로 AWS CLI 사용 (Access Key 발급 금지)
- [ ] 리전 설정: `ap-northeast-2` (서울)
- [ ] 예산 알림 설정 (Cost Explorer → $10 초과 시 알림)

---

## STEP 2. S3 버킷 생성 (반나절)

- [ ] 버킷 생성: `littleboss-documents`
- [ ] 퍼블릭 액세스 차단 설정
- [ ] 업로드 용량 제한 설정 (최대 10MB)
- [ ] 처리 완료 후 파일 자동 삭제 설정 (수명주기 규칙 7일)

---

## STEP 3. Amazon Textract 연동 Lambda (3~4일)

- [ ] Lambda 함수 생성: `littleboss-ocr-handler` (Python 3.11)
- [ ] S3 업로드 이벤트 트리거 설정
- [ ] Textract `analyze_document` API 호출 코드 작성
- [ ] 추출된 텍스트 → DynamoDB 저장
- [ ] 로컬 테스트: 장학금 공지 PDF로 OCR 정확도 확인

```python
# 핵심 코드 구조
import boto3

textract = boto3.client('textract', region_name='ap-northeast-2')

def handler(event, context):
    response = textract.analyze_document(
        Document={'S3Object': {'Bucket': bucket, 'Name': key}},
        FeatureTypes=['TABLES', 'FORMS']
    )
    # 텍스트 추출 후 다음 Lambda 호출
```

---

## STEP 4. AI 분석 Lambda (3~4일)

- [ ] Lambda 함수 생성: `littleboss-ai-analyzer` (Python 3.11)
- [ ] AI API 키 발급
  - Gemini: Google AI Studio에서 무료 발급
  - (또는) Claude: Anthropic Console에서 발급
- [ ] API 키 → Lambda 환경변수에 저장
- [ ] 프롬프트 작성 (마감일, 제출서류, 일정 추출)
- [ ] 응답 JSON 파싱 및 검증 로직
- [ ] 다양한 서류 유형 테스트 (장학금, 인턴십, 공모전)

```python
# Gemini 호출 예시
import google.generativeai as genai

PROMPT = """
다음 문서를 분석하여 JSON으로 반환하세요:
{
  "document_type": "서류 종류",
  "deadlines": [{"date": "YYYY-MM-DD", "description": "설명"}],
  "required_documents": [{"name": "서류명", "description": "설명"}],
  "calendar_events": [{"title": "제목", "date": "YYYY-MM-DD"}]
}

문서 내용:
"""
```

---

## STEP 5. DynamoDB 설계 및 생성 (1일)

- [ ] 테이블 생성
  - `littleboss-users` (user_id PK)
  - `littleboss-documents` (doc_id PK, user_id SK, DynamoDB Streams 활성화)
  - `littleboss-checklists` (checklist_id PK, GSI: doc_id-index)
- [ ] 인덱스 설정 (user_id로 조회 가능하도록 GSI 추가)

---

## STEP 6. Google Calendar 연동 Lambda (3~4일)

- [ ] Google Cloud Console에서 프로젝트 생성
- [ ] Google Calendar API 활성화
- [ ] OAuth 2.0 클라이언트 ID 발급
- [ ] Lambda 함수 생성: `littleboss-action-executor`
- [ ] Calendar 이벤트 생성 코드 작성
- [ ] 리마인더 설정 (D-7, D-3, D-1)
- [ ] 토큰 저장: Lambda 환경변수

---

## STEP 7. API Gateway 구성 (1~2일)

- [ ] REST API 생성
- [ ] 엔드포인트 설계

| Method | Path | Lambda | 설명 |
|--------|------|--------|------|
| GET | /health | littleboss-upload-handler | 서버 상태 확인 |
| POST | /upload | littleboss-upload-handler | 파일 업로드 → doc_id 즉시 반환 |
| GET | /documents | littleboss-upload-handler | 사용자 문서 목록 |
| GET | /documents/{doc_id} | littleboss-upload-handler | 상태 폴링 (프론트엔드 핵심) |
| POST | /calendar/{doc_id} | littleboss-action-executor | 캘린더 등록 |
| GET | /checklist/{doc_id} | littleboss-action-executor | 체크리스트 조회 |
| PATCH | /checklist/{doc_id} | littleboss-action-executor | 체크 완료 처리 |

- [ ] CORS 설정
- [ ] API 키 또는 인증 설정

---

## STEP 8. React 프론트엔드 (1~2주)

- [ ] 프로젝트 생성: `npx create-react-app littleboss-web`
- [ ] 주요 페이지 개발

### 화면 목록
1. **홈 / 업로드 화면**
   - 파일 드래그앤드롭 영역
   - Google 로그인 버튼

2. **분석 중 로딩 화면**
   - 진행 상태 표시 (OCR → 분석 → 완료)

3. **결과 화면**
   - 마감일 카드
   - 캘린더 등록 버튼
   - 준비물 체크리스트

4. **내 일정 목록 화면**
   - 처리한 서류 이력

- [ ] API Gateway 연동
- [ ] Google OAuth 로그인 구현
- [ ] 반응형 디자인 (모바일 대응)

---

## STEP 9. 통합 테스트 (3~4일)

- [ ] End-to-End 시나리오 테스트
  - 장학금 공지 PDF → 캘린더 등록까지 전체 흐름
  - 인턴십 서류 이미지 → 체크리스트 생성
- [ ] OCR 정확도 검증
- [ ] AI 분석 정확도 검증 (날짜 추출 오류율)
- [ ] 오류 케이스 처리 (지원 형식 외 파일, 텍스트 없는 이미지 등)

---

## STEP 10. 배포 (2~3일)

- [ ] React 빌드: `npm run build`
- [ ] S3 정적 웹사이트 호스팅 설정
- [ ] 도메인 연결 (선택)
- [ ] PWA 설정 (모바일 앱처럼 사용 가능하도록)

---

## STEP 11. 앱 (React Native) - 발표 이후

- [ ] 프로젝트 생성: `npx create-expo-app littleboss-app`
- [ ] 카메라 촬영 → 업로드 기능
- [ ] 기존 백엔드 API 재사용 (수정 없음)
- [ ] Android 먼저 배포 (Google Play $25 일회성)
- [ ] iOS 배포 (App Store $99/년, 선택)

---

## 전체 일정 요약

| 단계 | 내용 | 기간 |
|------|------|------|
| STEP 1~2 | AWS 세팅 + S3 | 3일 |
| STEP 3~4 | Textract + AI 분석 | 1주 |
| STEP 5~7 | DynamoDB + Calendar + API | 1주 |
| STEP 8 | React 프론트엔드 | 2주 |
| STEP 9~10 | 테스트 + 배포 | 1주 |
| **[캡스톤 발표]** | | |
| STEP 11 | React Native 앱 | 별도 |

**웹 완성까지 예상 기간: 5~6주**
