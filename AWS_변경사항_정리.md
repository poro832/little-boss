# LittleBoss - AWS 셋업 변경사항 정리

## 1. 개요

기존 **Gemini API 기반** AI 분석 구조에서 **AWS Bedrock (Claude 3 Sonnet) 기반**으로 전환하였습니다.
이로 인해 외부 API 의존성이 제거되고, AWS 생태계 내에서 완전히 통합된 서버리스 아키텍처가 구축되었습니다.

---

## 2. 기존 vs 변경 후 아키텍처 비교

### 2.1 핵심 차이점

| 항목 | 기존 (Gemini) | 변경 후 (Bedrock) |
|------|--------------|------------------|
| **AI 제공자** | Google Gemini API | AWS Bedrock (Claude 3 Sonnet) |
| **모델 ID** | `gemini-1.5-flash` | `anthropic.claude-3-sonnet-20240229-v1:0` |
| **외부 API Key** | `GEMINI_API_KEY` 필요 | 불필요 (IAM 권한으로 인증) |
| **외부 패키지** | `google-generativeai` 설치 필요 | `boto3` (Lambda 기본 제공) |
| **배포 방식** | ZIP 패키지 (Lambda Layer 또는 패키징) | 인라인 코드로 배포 가능 |
| **호출 리전** | 외부 (Google 서버) | AWS us-east-1 (cross-region) |
| **네트워크** | 인터넷 아웃바운드 | AWS 내부 네트워크 |
| **비용 모델** | Google Cloud 별도 청구 | AWS 통합 청구 |

### 2.2 아키텍처 다이어그램

#### 변경 전 (Gemini)
```
[Lambda ai-analyzer (ap-northeast-2)]
        ↓ (인터넷 호출)
[Google Gemini API]
        ↓
[GEMINI_API_KEY 인증]
```

#### 변경 후 (Bedrock)
```
[Lambda ai-analyzer (ap-northeast-2)]
        ↓ (cross-region, AWS 내부망)
[AWS Bedrock (us-east-1)]
        ↓
[IAM 역할 인증 - bedrock:InvokeModel]
```

> **왜 cross-region인가?**
> 학교 계정의 `RestrictRegionSeoul` 정책으로 서울 리전에서 Bedrock 호출이 차단되어 있습니다.
> us-east-1에서는 Claude 3 Sonnet, Haiku 등 다양한 모델을 활용할 수 있습니다.

---

## 3. 변경된 환경 변수

### 3.1 ai-analyzer Lambda

| 환경변수 | 기존 | 변경 후 |
|---------|------|--------|
| `GEMINI_API_KEY` | 필수 (외부 발급) | 삭제 |
| `BEDROCK_REGION` | - | `us-east-1` (신규) |
| `BEDROCK_MODEL_ID` | - | `anthropic.claude-3-sonnet-20240229-v1:0` (신규) |
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` | 동일 |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` | 동일 |

### 3.2 Lambda 설정

| 항목 | 기존 | 변경 후 |
|------|------|--------|
| 타임아웃 | 60초 | 60초 (동일) |
| 메모리 | 512MB | 256MB (감소 - 외부 패키지 불필요) |
| 배포 패키지 | ZIP (google-generativeai 포함) | 인라인 코드 |

---

## 4. 필요한 권한 정리

### 4.1 권한 분류

권한은 적용 방식에 따라 **3가지 유형**으로 분류됩니다.

| 유형 | 설명 | 학교 계정에서 가능 여부 |
|------|------|----------------------|
| **리소스 기반 정책** | 리소스(S3 버킷, DynamoDB 테이블)에 직접 부착 | ✅ 가능 |
| **IAM 인라인 정책** | Lambda 실행 역할에 추가 (관리자 요청) | ⚠️ 관리자 요청 필요 |
| **기본 제공 권한** | `Nxt-Lambda-Basic-Role`이 기본 보유 | ✅ 자동 |

### 4.2 권한 매트릭스

| Lambda | 필요 권한 | 적용 방식 |
|--------|----------|----------|
| upload-handler | `s3:PutObject`, `s3:GetObject` | 🔵 S3 버킷 정책 |
| upload-handler | `dynamodb:PutItem`, `Query`, `GetItem` | 🟢 DynamoDB 리소스 정책 |
| ocr-handler | `s3:GetObject` | 🔵 S3 버킷 정책 |
| ocr-handler | `dynamodb:UpdateItem` | 🟢 DynamoDB 리소스 정책 |
| ai-analyzer | `dynamodb:UpdateItem` | 🟢 DynamoDB 리소스 정책 |
| ai-analyzer | `s3:PutObject` (분석결과) | 🔵 S3 버킷 정책 |
| ai-analyzer | **`bedrock:InvokeModel`** | 🟡 IAM 인라인 정책 (필수, 관리자 요청) |
| 모든 Lambda | CloudWatch Logs | ⚪ 기본 제공 |

### 4.3 S3 버킷 정책 (Resource-based)

`sgu-pj-01-littleboss-docs` 버킷에 부착:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/Nxt-Lambda-Basic-Role"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::sgu-pj-01-littleboss-docs/*"
    }
  ]
}
```

### 4.4 DynamoDB 리소스 정책 (Resource-based)

`sgu-pj-01-documents` 테이블에 부착:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaCRUD",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/Nxt-Lambda-Basic-Role"
      },
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-northeast-2:ACCOUNT_ID:table/sgu-pj-01-documents",
        "arn:aws:dynamodb:ap-northeast-2:ACCOUNT_ID:table/sgu-pj-01-documents/index/*"
      ]
    }
  ]
}
```

### 4.5 Bedrock IAM 인라인 정책 (관리자 요청 필요)

`Nxt-Lambda-Basic-Role`에 추가 (또는 `Nxt-Lambda-Bedrock-Role` 사용):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBedrockInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
      ]
    }
  ]
}
```

### 4.6 Bedrock 모델 활성화 (콘솔 작업)

1. AWS Console → **us-east-1 리전 전환**
2. Bedrock → Model access → **Manage model access**
3. Anthropic Claude 3 Sonnet 체크 → Request access
4. 승인 완료 (보통 즉시) 후 사용 가능

---

## 5. DynamoDB 데이터 구조 (JSON)

### 5.1 테이블 키 설계

| 키 | 속성명 | 타입 |
|----|-------|------|
| Partition Key | `doc_id` | String (UUID) |
| Sort Key | `user_id` | String |
| GSI | `user_id-index` (PK: user_id) | - |

### 5.2 업로드 직후 (status: UPLOADED)

```json
{
  "doc_id": "33e0a9a6-2f60-4f47-adba-5929ecd05ae2",
  "user_id": "local_user",
  "filename": "장학금공지.pdf",
  "file_path": "uploads/33e0a9a6-2f60-4f47-adba-5929ecd05ae2/장학금공지.pdf",
  "status": "UPLOADED",
  "created_at": "2026-04-21T14:59:29.057725"
}
```

### 5.3 OCR 완료 후 (status: ocr_done)

```json
{
  "doc_id": "33e0a9a6-2f60-4f47-adba-5929ecd05ae2",
  "user_id": "local_user",
  "filename": "장학금공지.pdf",
  "file_path": "uploads/33e0a9a6-2f60-4f47-adba-5929ecd05ae2/장학금공지.pdf",
  "status": "ocr_done",
  "raw_text": "2026학년도 1학기 교내 장학금 신청 안내\n신청 기간: 3월 1일 ~ 3월 15일...",
  "created_at": "2026-04-21T14:59:29.057725",
  "updated_at": "2026-04-21T15:00:45.123456"
}
```

### 5.4 AI 분석 완료 후 (status: done) - **전체 파이프라인 완료**

```json
{
  "doc_id": "33e0a9a6-2f60-4f47-adba-5929ecd05ae2",
  "user_id": "local_user",
  "filename": "장학금공지.pdf",
  "file_path": "uploads/33e0a9a6-2f60-4f47-adba-5929ecd05ae2/장학금공지.pdf",
  "status": "done",
  "raw_text": "2026학년도 1학기 교내 장학금 신청 안내...",
  "analysis": {
    "document_type": "장학금 공지",
    "summary": "2026학년도 1학기 교내 장학금 신청 안내. 신청 기간은 3월 15일까지이며, 성적증명서와 재학증명서가 필요합니다.",
    "deadlines": [
      {
        "date": "2026-03-15",
        "description": "장학금 신청 마감",
        "urgency": "high"
      }
    ],
    "required_documents": [
      {
        "name": "성적증명서",
        "description": "직전 학기 성적증명서 1부",
        "have": false
      },
      {
        "name": "재학증명서",
        "description": "재학증명서 1부",
        "have": false
      }
    ],
    "calendar_events": [
      {
        "title": "장학금 신청 마감",
        "date": "2026-03-15",
        "time": "23:59",
        "description": "교내 장학금 온라인 신청 마감일"
      }
    ]
  },
  "checklist": [
    {
      "name": "성적증명서",
      "description": "직전 학기 성적증명서 1부",
      "completed": false
    },
    {
      "name": "재학증명서",
      "description": "재학증명서 1부",
      "completed": false
    }
  ],
  "created_at": "2026-04-21T14:59:29.057725",
  "updated_at": "2026-04-21T15:01:12.000000"
}
```

### 5.5 에러 발생 시 (status: error)

```json
{
  "doc_id": "33e0a9a6-2f60-4f47-adba-5929ecd05ae2",
  "user_id": "local_user",
  "filename": "test.pdf",
  "status": "error",
  "raw_text": "",
  "analysis": null,
  "error_message": "AI 분석 실패: AccessDeniedException ...",
  "created_at": "2026-04-21T14:59:29.057725",
  "updated_at": "2026-04-21T15:00:30.000000"
}
```

---

## 6. 상태 흐름 (Status Flow)

```
UPLOADED → ocr_done → ai_processing → done
                                        ↘ error (실패 시)
```

| 상태 | 트리거 Lambda | 다음 단계 |
|------|--------------|----------|
| `UPLOADED` | upload-handler | S3 업로드 완료 시 → OCR |
| `ocr_done` | ocr-handler | DynamoDB Streams → AI 분석 |
| `ai_processing` | ai-analyzer | Bedrock 호출 중 |
| `done` | ai-analyzer | 프론트엔드에서 결과 표시 |
| `error` | ocr-handler / ai-analyzer | 프론트엔드에서 에러 표시 |

---

## 7. 변경의 정량적 효과

| 항목 | 개선 효과 |
|------|----------|
| 외부 API Key 관리 | 불필요 (보안성 ↑) |
| 외부 패키지 크기 | ~30MB → 0MB (Lambda 콜드스타트 단축) |
| 배포 복잡도 | ZIP 패키징 → 인라인 코드 (배포 시간 단축) |
| 청구 통합 | 분리(Google + AWS) → 통합(AWS) |
| 네트워크 보안 | 인터넷 아웃바운드 → AWS 내부망 |
| 메모리 요구량 | 512MB → 256MB (비용 절감) |

---

## 8. 발표 시 강조 포인트

1. **AWS 네이티브 통합**: 외부 API 제거 → AWS 생태계 단일화
2. **보안 강화**: API Key 환경변수 관리 → IAM 역할 기반 인증
3. **비용 최적화**: 단일 청구 + 메모리 감소
4. **운영 단순화**: 인라인 배포로 ZIP 패키징/Layer 의존성 제거
5. **실무 패턴 적용**: cross-region 호출(서울 ↔ 버지니아)을 통한 리전 제약 우회
