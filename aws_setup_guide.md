# LittleBoss AWS 설정 실습 가이드 (Bedrock 버전)

> 학교 제공 AWS 계정 (`sgu-pj-01`)용 실습 가이드입니다.
> **모든 리소스 이름에 `sgu-pj-01-` 접두사 필수** / **IAM 역할 생성 불가** (기존 `Nxt-Lambda-Basic-Role` 재사용)
> Lambda/DynamoDB/S3는 **서울 리전 (`ap-northeast-2`)**, **Bedrock만 버지니아 북부 (`us-east-1`)** 사용

---

## 전체 설정 순서 한눈에 보기

```
1단계  S3 버킷 (서류용)             ← 파일 저장소 (서울)
2단계  DynamoDB 테이블 3개          ← 데이터베이스 (서울)
3단계  Bedrock 모델 액세스 활성화    ← Claude 3 Sonnet (us-east-1)
4단계  Lambda 함수 4개              ← 백엔드 로직 (서울, Nxt-Lambda-Basic-Role)
5단계  S3 → Lambda 트리거           ← 파일 업로드 시 OCR 자동 실행
6단계  DynamoDB Streams 트리거      ← OCR 완료 시 AI 분석 자동 실행
7단계  API Gateway                  ← 프론트엔드 ↔ Lambda 연결
8단계  SNS 토픽 + 이메일 구독        ← 마감일 알림
9단계  EventBridge 스케줄 그룹       ← 알림 스케줄러
10단계 S3 정적 호스팅 (프론트)        ← React 앱 배포
```

> **변경점**: 기존 Gemini API → AWS Bedrock(Claude 3 Sonnet)으로 변경.
> Lambda Layer는 학교 계정 정책으로 생성 불가 → 외부 패키지가 필요한 함수만 ZIP에 직접 포함 (action-executor만 해당).

---

## 0단계: 사전 확인

### 리전 확인
- 기본 작업 리전: **아시아 태평양(서울) `ap-northeast-2`**
- Bedrock 작업 시에만: **미국 동부(버지니아 북부) `us-east-1`**

### 사용할 IAM 역할
- **Lambda 실행 역할**: `Nxt-Lambda-Basic-Role`
- **ARN**: `arn:aws:iam::443370697536:role/Nxt-Lambda-Basic-Role`

### 필요한 외부 키 (미리 준비)
| 키 | 발급처 |
|----|--------|
| Google OAuth Client ID / Secret | [Google Cloud Console](https://console.cloud.google.com/) |

> ✅ **Gemini API Key는 더 이상 필요하지 않습니다** (Bedrock으로 대체).

---

## 1단계: S3 버킷 생성 (서류 저장용)

### 1-1. 버킷 만들기

1. AWS 콘솔 → **S3** → **버킷 만들기**
2. 설정:
   - **버킷 이름**: `sgu-pj-01-littleboss-docs` ⚠️ 접두사 필수
   - **AWS 리전**: 아시아 태평양(서울) ap-northeast-2
   - **객체 소유권**: ACL 비활성화됨
   - **모든 퍼블릭 액세스 차단** 체크 (기본값 유지)
   - **버킷 버전 관리**: 비활성화
   - **기본 암호화**: SSE-S3
3. **버킷 만들기** 클릭

### 1-2. 폴더 생성

1. 생성된 `sgu-pj-01-littleboss-docs` 클릭
2. **폴더 만들기** → `uploads` → **폴더 만들기**
3. 같은 방식으로 `ocr-results`, `analysis-results` 폴더 생성

최종 구조:
```
sgu-pj-01-littleboss-docs/
├── uploads/
├── ocr-results/
└── analysis-results/
```

### 1-3. CORS 설정

1. 버킷 → **권한** 탭 → 맨 아래 **Cross-Origin 리소스 공유(CORS)** → **편집**
2. 붙여넣기:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://sgu-pj-01-littleboss-frontend.s3-website.ap-northeast-2.amazonaws.com"
    ],
    "ExposeHeaders": ["ETag"]
  }
]
```

3. **변경 사항 저장**

### 1-4. 버킷 정책 (Lambda 권한 우회)

학교 계정의 `Nxt-Lambda-Basic-Role`에 S3 권한이 없으므로, 버킷 정책으로 Lambda가 접근하도록 허용합니다.

1. 버킷 → **권한** 탭 → **버킷 정책** → **편집**
2. 붙여넣기:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaPutGetObject",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::443370697536:role/Nxt-Lambda-Basic-Role"
      },
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::sgu-pj-01-littleboss-docs",
        "arn:aws:s3:::sgu-pj-01-littleboss-docs/*"
      ]
    }
  ]
}
```

3. **변경 사항 저장**

### 1-5. 수명 주기 규칙 (선택)

1. 버킷 → **관리** 탭 → **수명 주기 규칙 생성**
2. 설정:
   - **규칙 이름**: `auto-delete-uploads`
   - **접두사 필터**: `uploads/`
   - **객체의 현재 버전 만료** 체크 → **30일**
3. **규칙 생성**

---

## 2단계: DynamoDB 테이블 생성 (3개)

모두 **온디맨드 용량 모드**로 생성.

### 2-1. users 테이블

1. DynamoDB → **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-users`
   - **파티션 키**: `user_id` (문자열)
   - **설정 사용자 지정** → **읽기/쓰기 용량: 온디맨드**
3. **테이블 생성**

### 2-2. documents 테이블

1. **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-documents`
   - **파티션 키**: `doc_id` (문자열)
   - **읽기/쓰기 용량: 온디맨드**
3. **테이블 생성**

#### GSI 추가

1. `sgu-pj-01-documents` → **인덱스** 탭 → **인덱스 생성**
2. 설정:
   - **파티션 키**: `user_id` (문자열)
   - **인덱스 이름**: `user_id-index`
   - **프로젝션 유형**: `모두`
3. **인덱스 생성**

> ⚠️ DynamoDB Streams는 6단계에서 Lambda를 먼저 만든 뒤 설정합니다.

### 2-3. checklists 테이블

1. **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-checklists`
   - **파티션 키**: `checklist_id` (문자열)
   - **읽기/쓰기 용량: 온디맨드**
3. **테이블 생성**

#### GSI 추가

1. `sgu-pj-01-checklists` → **인덱스** 탭 → **인덱스 생성**
2. 설정:
   - **파티션 키**: `doc_id` (문자열)
   - **인덱스 이름**: `doc_id-index`
   - **프로젝션 유형**: `모두`
3. **인덱스 생성**

### 2-4. 리소스 기반 정책 (Lambda 권한 우회)

각 테이블의 **권한 탭 → 리소스 기반 정책**에 아래 정책 적용 (3개 테이블 모두).

`sgu-pj-01-documents` 예시:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaRoleAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::443370697536:role/Nxt-Lambda-Basic-Role"
      },
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents",
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents/index/*",
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents/stream/*"
      ]
    }
  ]
}
```

> 콘솔에서 안 되면 CloudShell에서:
> ```bash
> aws dynamodb put-resource-policy \
>   --resource-arn arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents \
>   --policy "$(cat policy.json)" \
>   --region ap-northeast-2
> ```

### 2-5. 확인

DynamoDB 대시보드에 3개 테이블이 **활성** 상태로 표시되는지 확인:
- `sgu-pj-01-users`
- `sgu-pj-01-documents` (+ `user_id-index`)
- `sgu-pj-01-checklists` (+ `doc_id-index`)

---

## 3단계: Bedrock 모델 액세스 활성화

> ⚠️ **반드시 리전을 `us-east-1`로 변경한 뒤 진행하세요.** 학교 계정은 서울 리전에서 Bedrock 사용 불가.

### 3-1. 리전 변경

AWS 콘솔 우측 상단 → **미국 동부(버지니아 북부) `us-east-1`** 선택.

### 3-2. 모델 액세스 신청

1. 콘솔 → **Amazon Bedrock** → 좌측 메뉴 **Model access**
2. 우측 상단 **Modify model access** (또는 **Manage model access**)
3. **Anthropic Claude 3 Sonnet** 체크
4. (선택) Claude 3 Haiku도 함께 체크 (백업용)
5. **Next** → 사용 사례 입력 (간단히 "Educational project for document analysis") → **Submit**

> 보통 **즉시 활성화**됩니다. 상태가 "Access granted"로 바뀌면 OK.

### 3-3. 활성화 확인

CloudShell에서:
```bash
aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id anthropic.claude-3-sonnet-20240229-v1:0 \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":100,"messages":[{"role":"user","content":"안녕"}]}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json
```

`content` 필드에 한국어 응답이 보이면 성공.

### 3-4. Lambda 역할에 Bedrock 권한 추가 (CloudShell)

`Nxt-Lambda-Basic-Role`에 `bedrock:InvokeModel` 권한이 없으므로 인라인 정책 추가 시도:

```bash
cat > /tmp/bedrock-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name Nxt-Lambda-Basic-Role \
  --policy-name LittleBoss-Bedrock-Invoke \
  --policy-document file:///tmp/bedrock-policy.json
```

> 거부되면 학교 관리자에게 위 정책 첨부 요청.

---

## 4단계: Lambda 함수 생성 (4개)

### 공통 생성 절차

1. Lambda → **함수** → **함수 생성** (리전: **서울 ap-northeast-2**)
2. **새로 작성** 선택
3. 이름, 런타임 입력
4. **실행 역할** → `기존 역할 사용` → **`Nxt-Lambda-Basic-Role`** 선택 ⚠️
5. **함수 생성**
6. 생성 후 일반 구성 편집, 환경 변수 추가

> 💡 **Lambda Layer는 사용하지 않습니다.** 학교 계정 정책으로 Layer 생성이 차단되어 있고, 새 아키텍처에서는 ai-analyzer도 boto3만 사용하므로 Layer가 필요 없습니다.

---

### 4-1. `sgu-pj-01-upload-handler`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-upload-handler` |
| 런타임 | Python 3.11 |
| 아키텍처 | x86_64 |
| 실행 역할 | `Nxt-Lambda-Basic-Role` |

**생성 후 설정:**

#### 일반 구성
- **타임아웃**: 30초, **메모리**: 256 MB

#### 환경 변수
| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `ENV` | `production` |

#### 배포 방식
**콘솔 인라인** (boto3만 사용 → 외부 패키지 불필요)

---

### 4-2. `sgu-pj-01-ocr-handler`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-ocr-handler` |
| 런타임 | Python 3.11 |
| 실행 역할 | `Nxt-Lambda-Basic-Role` |

**생성 후 설정:**
- **타임아웃**: 1분 0초 (Textract 고려), **메모리**: 256 MB

#### 환경 변수
| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `ENV` | `production` |

#### 배포 방식
**콘솔 인라인**

---

### 4-3. `sgu-pj-01-ai-analyzer` ⭐ 변경됨

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-ai-analyzer` |
| 런타임 | Python 3.11 |
| 실행 역할 | `Nxt-Lambda-Basic-Role` |

**생성 후 설정:**
- **타임아웃**: 1분 0초, **메모리**: 256 MB

#### 환경 변수
| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `BEDROCK_REGION` | `us-east-1` ⭐ |
| `BEDROCK_MODEL_ID` | `anthropic.claude-3-sonnet-20240229-v1:0` ⭐ |
| `ENV` | `production` |

> ❌ `GEMINI_API_KEY` 더 이상 사용 안 함

#### 배포 방식
**콘솔 인라인** ⭐ (boto3는 Lambda 런타임에 내장 → ZIP 패키징 불필요)

---

### 4-4. `sgu-pj-01-action-executor`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-action-executor` |
| 런타임 | Python 3.11 |
| 실행 역할 | `Nxt-Lambda-Basic-Role` |

**생성 후 설정:**
- **타임아웃**: 30초, **메모리**: 512 MB

#### 환경 변수
| 키 | 값 |
|----|-----|
| `CHECKLISTS_TABLE` | `sgu-pj-01-checklists` |
| `USERS_TABLE` | `sgu-pj-01-users` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `GOOGLE_CLIENT_ID` | (실제 OAuth Client ID) |
| `GOOGLE_CLIENT_SECRET` | (실제 OAuth Client Secret) |
| `SNS_TOPIC_ARN` | (8단계에서 입력) |
| `SCHEDULE_GROUP` | `sgu-pj-01-littleboss-reminders` |
| `ENV` | `production` |

#### 배포 방식
**ZIP 업로드** (google-api-python-client 패키지 포함 필요 — `LAMBDA_GUIDE.md` 참고)

### 4-5. 확인

Lambda 함수 목록에서 4개 확인:
- `sgu-pj-01-upload-handler`
- `sgu-pj-01-ocr-handler`
- `sgu-pj-01-ai-analyzer`
- `sgu-pj-01-action-executor`

---

## 5단계: S3 → Lambda 트리거 설정

### 5-1. 이벤트 알림 생성

1. S3 → `sgu-pj-01-littleboss-docs` → **속성** 탭
2. 아래로 스크롤 → **이벤트 알림 생성**
3. 설정:
   - **이벤트 이름**: `trigger-ocr-on-upload`
   - **접두사**: `uploads/`
   - **이벤트 유형**: `모든 객체 생성 이벤트`
   - **대상**: `Lambda 함수` → `sgu-pj-01-ocr-handler`
4. **변경 사항 저장**

### 5-2. 확인

- `sgu-pj-01-ocr-handler` → **구성** → **트리거** 탭에 S3 트리거 표시

---

## 6단계: DynamoDB Streams → Lambda 트리거

### 6-1. Streams 활성화

1. DynamoDB → `sgu-pj-01-documents` → **내보내기 및 스트림** 탭
2. **DynamoDB 스트림 세부 정보** → **활성화**
3. **보기 유형**: `새 이미지` (NEW_IMAGE)
4. **스트림 활성화**

### 6-2. 트리거 연결

1. 같은 페이지 **트리거** 섹션 → **트리거 생성**
2. 설정:
   - **Lambda 함수**: `sgu-pj-01-ai-analyzer`
   - **배치 크기**: `1`
   - **시작 위치**: `최신`
3. **트리거 생성**

### 6-3. 확인

- `sgu-pj-01-ai-analyzer` → **구성** → **트리거** 탭에 DynamoDB 트리거 표시

---

## 7단계: API Gateway 생성

### 7-1. API 생성

1. API Gateway → **API 생성** → **REST API** → **구축**
2. 설정:
   - **API 이름**: `sgu-pj-01-littleboss-api`
   - **엔드포인트 유형**: `리전`
3. **API 생성**

### 7-2. 리소스 및 메서드 생성

| 메서드 | 경로 | 연결 Lambda |
|--------|------|-------------|
| GET | `/health` | `sgu-pj-01-upload-handler` |
| POST | `/upload` | `sgu-pj-01-upload-handler` |
| GET | `/documents` | `sgu-pj-01-upload-handler` |
| GET | `/documents/{doc_id}` | `sgu-pj-01-upload-handler` |
| POST | `/calendar/{doc_id}` | `sgu-pj-01-action-executor` |
| GET | `/checklist/{doc_id}` | `sgu-pj-01-action-executor` |
| PATCH | `/checklist/{doc_id}` | `sgu-pj-01-action-executor` |

#### 리소스 생성 (예: `/upload`)
1. `/` 선택 → **리소스 생성**
2. **리소스 이름**: `upload` → **CORS 활성화** 체크 → **리소스 생성**

#### 경로 파라미터 리소스 (예: `/documents/{doc_id}`)
1. `/documents` 생성 후 → 그 아래 `{doc_id}` 리소스 생성 (이름에 중괄호 포함)

#### 메서드 생성 (예: POST /upload)
1. 리소스 선택 → **메서드 생성**
2. 설정:
   - **메서드 유형**: `POST`
   - **통합 유형**: `Lambda 함수`
   - **Lambda 프록시 통합**: ✅ 체크
   - **Lambda 함수**: `sgu-pj-01-upload-handler`
3. **메서드 생성** → 권한 추가 확인

### 7-3. Lambda 응답 헤더 (CORS)

Lambda 프록시 통합이므로 Lambda 응답에 CORS 헤더 포함 필수:
```python
return {
    "statusCode": 200,
    "headers": {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    "body": json.dumps(response_data)
}
```

### 7-4. 배포

1. **API 배포** 버튼 클릭
2. **스테이지**: `새 스테이지` → 이름 `prod`
3. **배포**

### 7-5. API URL 확인

배포 후 **호출 URL** 복사:
```
https://{api-id}.execute-api.ap-northeast-2.amazonaws.com/prod
```

프론트엔드 `.env`의 `REACT_APP_API_URL`로 설정.

---

## 8단계: SNS 토픽 + 이메일 구독

> ⚠️ **`sns:DeleteTopic` 권한이 없으므로 토픽 이름을 신중히 입력하세요. 잘못 만들면 삭제 불가.**

### 8-1. SNS 토픽 생성

1. SNS → 좌측 **주제** → **주제 생성**
2. 설정:
   - **유형**: `표준`
   - **이름**: `sgu-pj-01-deadline-alerts`
3. **주제 생성**
4. **ARN 복사**: `arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-01-deadline-alerts`

### 8-2. 이메일 구독 추가

1. 토픽 상세 페이지 → **구독 생성**
2. 설정:
   - **프로토콜**: `이메일`
   - **엔드포인트**: 수신 이메일 주소
3. **구독 생성**
4. 받은편지함에서 AWS 확인 메일의 **Confirm subscription** 링크 클릭

### 8-3. Lambda 환경변수 업데이트

1. Lambda → `sgu-pj-01-action-executor` → **구성** → **환경 변수** → **편집**
2. `SNS_TOPIC_ARN` 값에 복사한 ARN 입력 → **저장**

---

## 9단계: EventBridge 스케줄 그룹

### 9-1. 스케줄 그룹 생성

1. EventBridge → 좌측 **스케줄러** → **스케줄 그룹** → **그룹 생성**
2. **이름**: `sgu-pj-01-littleboss-reminders`
3. **그룹 생성**

실제 스케줄은 Lambda 코드에서 동적으로 생성합니다.

> ⚠️ 런타임에 `scheduler:CreateSchedule` 권한 부족으로 오류가 뜰 수 있음. 그때 관리자에게 요청.

---

## 10단계: S3 정적 호스팅 (프론트엔드)

### 10-1. 프론트엔드 버킷 생성

1. S3 → **버킷 만들기**
2. 설정:
   - **버킷 이름**: `sgu-pj-01-littleboss-frontend` ⚠️ 접두사 필수
   - **리전**: ap-northeast-2
   - **모든 퍼블릭 액세스 차단** → **체크 해제** (경고 확인 체크 포함)
3. **버킷 만들기**

### 10-2. 정적 웹사이트 호스팅 활성화

1. `sgu-pj-01-littleboss-frontend` → **속성** 탭
2. 맨 아래 **정적 웹사이트 호스팅** → **편집**
3. 설정:
   - **활성화**
   - **호스팅 유형**: 정적 웹사이트 호스팅
   - **인덱스 문서**: `index.html`
   - **오류 문서**: `index.html`
4. **변경 사항 저장**

### 10-3. 버킷 정책 (퍼블릭 읽기)

1. 버킷 → **권한** 탭 → **버킷 정책** → **편집**
2. 붙여넣기:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sgu-pj-01-littleboss-frontend/*"
    }
  ]
}
```

3. **변경 사항 저장**

### 10-4. 프론트엔드 빌드 & 배포

CloudShell에서:
```bash
cd frontend
npm run build
aws s3 sync build/ s3://sgu-pj-01-littleboss-frontend --delete
```

### 10-5. 접속 확인

```
http://sgu-pj-01-littleboss-frontend.s3-website.ap-northeast-2.amazonaws.com
```

---

## 최종 점검 체크리스트

| # | 확인 항목 | 확인 방법 |
|---|----------|----------|
| 1 | S3 버킷 2개 존재 | `sgu-pj-01-littleboss-docs`, `sgu-pj-01-littleboss-frontend` |
| 2 | S3 버킷 정책 적용 | docs 버킷 → 권한 → 버킷 정책 |
| 3 | DynamoDB 테이블 3개 활성 | users, documents, checklists |
| 4 | DynamoDB 리소스 정책 적용 | 각 테이블 → 권한 탭 |
| 5 | **Bedrock Claude 3 Sonnet 액세스 활성화** | us-east-1 → Bedrock → Model access |
| 6 | **Bedrock InvokeModel 권한 추가됨** | IAM → Nxt-Lambda-Basic-Role |
| 7 | Lambda 함수 4개 존재 | upload-handler, ocr-handler, ai-analyzer, action-executor |
| 8 | 모든 Lambda가 `Nxt-Lambda-Basic-Role` 사용 | 구성 → 권한 탭 |
| 9 | S3 트리거 동작 | 테스트 파일 업로드 → CloudWatch Logs에 ocr-handler 실행 로그 |
| 10 | DynamoDB Streams 트리거 동작 | 테스트 레코드 추가 → ai-analyzer 실행 로그 |
| 11 | API Gateway 호출 가능 | 브라우저에서 `{API URL}/prod/health` |
| 12 | SNS 이메일 구독 "확인됨" | SNS → 구독 상태 |
| 13 | 프론트엔드 접속 가능 | S3 웹사이트 URL |

---

## 환경변수 총정리

### sgu-pj-01-upload-handler
```
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
ENV                 = production
```

### sgu-pj-01-ocr-handler
```
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
ENV                 = production
```

### sgu-pj-01-ai-analyzer ⭐
```
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
BEDROCK_REGION      = us-east-1
BEDROCK_MODEL_ID    = anthropic.claude-3-sonnet-20240229-v1:0
ENV                 = production
```

### sgu-pj-01-action-executor
```
CHECKLISTS_TABLE    = sgu-pj-01-checklists
USERS_TABLE         = sgu-pj-01-users
DOCUMENTS_TABLE     = sgu-pj-01-documents
GOOGLE_CLIENT_ID    = (실제 ID)
GOOGLE_CLIENT_SECRET = (실제 Secret)
SNS_TOPIC_ARN       = arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-01-deadline-alerts
SCHEDULE_GROUP      = sgu-pj-01-littleboss-reminders
ENV                 = production
```

---

## Bedrock Cross-Region 호출 패턴

```
[서울 리전 ap-northeast-2]                  [버지니아 북부 us-east-1]
┌──────────────────────┐                    ┌─────────────────────┐
│  Lambda ai-analyzer  │ ────invoke_model──→│  Bedrock            │
│  (boto3 client에     │                    │  Claude 3 Sonnet    │
│   region 명시)       │ ←────응답──────────│                     │
└──────────────────────┘                    └─────────────────────┘
```

핵심 코드 (ai-analyzer 내부):
```python
bedrock = boto3.client('bedrock-runtime', region_name=os.environ['BEDROCK_REGION'])
```

---

## 트러블슈팅

### 리소스 생성 시 "AccessDenied" / "explicit deny"
→ 이름에 `sgu-pj-01-` 접두사가 붙었는지 확인. 대부분의 리소스는 접두사 없이는 생성 불가.

### Lambda 실행 시 CloudWatch Logs에 "AccessDenied"
→ `Nxt-Lambda-Basic-Role`의 권한 부족. 어떤 액션이 거부됐는지 로그에서 확인.
→ S3/DynamoDB는 리소스 기반 정책으로 우회 가능 (위 1-4, 2-4 절 참고).
→ Bedrock/Textract/SNS/Scheduler는 IAM 인라인 정책 시도, 거부 시 관리자 요청.

### Bedrock InvokeModel 실패: AccessDenied
→ 모델 액세스가 활성화됐는지 확인 (3-2 절).
→ Lambda 역할에 `bedrock:InvokeModel` 권한 있는지 확인 (3-4 절).
→ 리전이 `us-east-1`로 정확히 호출되는지 확인.

### Bedrock InvokeModel 실패: ValidationException
→ 모델 ID 오타 확인 (`anthropic.claude-3-sonnet-20240229-v1:0`).
→ request body 형식이 Claude messages API 형식인지 확인.

### Textract 호출 실패
→ `Nxt-Lambda-Basic-Role`에 `textract:*` 권한이 없을 가능성. 관리자 요청 필요.

### SNS Publish 실패
→ `sns:Publish` 권한 부족. 토픽 자체에 리소스 정책 추가하거나 관리자 요청.

### EventBridge 스케줄 생성 실패 (런타임)
→ `scheduler:CreateSchedule` 권한 부족. 관리자 요청 필요.

### S3 트리거가 동작하지 않음
→ 접두사가 `uploads/`로 정확히 설정되었는지 확인.

### DynamoDB Streams 트리거가 동작하지 않음
→ 보기 유형이 `새 이미지`(NEW_IMAGE)인지 확인.

### API Gateway CORS 오류
→ Lambda 응답에 `Access-Control-Allow-Origin` 헤더가 포함되어 있는지 확인.
