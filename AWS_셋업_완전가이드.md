# LittleBoss AWS 셋업 완전 가이드

> 학교 제공 AWS 계정 (`sgu-pj-01`) 전용 가이드입니다.
> **모든 리소스 이름에 `sgu-pj-01-` 접두사 필수** / **IAM 역할 생성 불가** (기존 `Nxt-Lambda-Basic-Role` 재사용)
> Lambda / DynamoDB / S3 → **서울 리전 (`ap-northeast-2`)** | Bedrock → **버지니아 북부 (`us-east-1`)**

---

## 전체 설정 순서

```
0단계  권한 사전 점검               ← 시작 전 필수 확인
1단계  S3 버킷 생성                 ← 파일 저장소 (서울)
2단계  DynamoDB 테이블 생성          ← 데이터베이스 (서울)
3단계  Bedrock 모델 액세스 활성화    ← Claude 3 Sonnet (us-east-1)
4단계  Lambda 함수 4개 생성         ← 백엔드 로직 (서울)
5단계  S3 → Lambda 트리거           ← 파일 업로드 시 OCR 자동 실행
6단계  DynamoDB Streams 트리거      ← OCR 완료 시 AI 분석 자동 실행
7단계  API Gateway                  ← 프론트엔드 ↔ Lambda 연결
8단계  SNS 토픽 + 이메일 구독        ← 마감일 알림
9단계  EventBridge 스케줄 그룹       ← 알림 스케줄러
10단계 S3 정적 호스팅               ← React 앱 배포
```

---

## 0단계: 권한 사전 점검 ⚠️ 반드시 먼저 실행

셋업 도중 권한 오류로 막히는 상황을 최소화하기 위해, **CloudShell에서 아래 점검을 먼저 실행**합니다.

> AWS 콘솔 → 우측 상단 CloudShell 아이콘 클릭 → 아래 명령어 입력

---

### 0-1. 현재 Lambda 역할 보유 권한 조회

현재 `Nxt-Lambda-Basic-Role`에 어떤 정책이 붙어있는지 확인합니다.

```bash
# 연결된 관리형 정책 목록
aws iam list-attached-role-policies \
  --role-name Nxt-Lambda-Basic-Role

# 인라인 정책 목록
aws iam list-role-policies \
  --role-name Nxt-Lambda-Basic-Role
```

**결과 해석:**
- `AWSLambdaBasicExecutionRole` → CloudWatch Logs 기본 권한 있음 (정상)
- Bedrock 관련 정책이 없으면 → 3-4절에서 추가 필요

---

### 0-2. S3 권한 점검

```bash
# 버킷에 객체 업로드 가능 여부 테스트
echo "test" > /tmp/perm-test.txt
aws s3 cp /tmp/perm-test.txt \
  s3://sgu-pj-01-littleboss-docs/uploads/perm-test.txt \
  2>&1

# 성공: upload: /tmp/perm-test.txt to s3://...
# 실패: An error occurred (AccessDenied)
```

> ❌ 실패 시 → 1-4절의 버킷 정책을 먼저 적용한 뒤 재시도

---

### 0-3. DynamoDB 권한 점검

```bash
# 테이블 쓰기 테스트
aws dynamodb put-item \
  --table-name sgu-pj-01-documents \
  --item '{"doc_id":{"S":"perm-test"},"user_id":{"S":"test"}}' \
  --region ap-northeast-2 \
  2>&1

# 성공: (출력 없음)
# 실패: An error occurred (AccessDeniedException)
```

> ❌ 실패 시 → 2-4절의 DynamoDB 리소스 정책 적용 필요

```bash
# 테스트 항목 삭제 (점검 후 정리)
aws dynamodb delete-item \
  --table-name sgu-pj-01-documents \
  --key '{"doc_id":{"S":"perm-test"},"user_id":{"S":"test"}}' \
  --region ap-northeast-2
```

---

### 0-4. Bedrock 권한 점검

```bash
# Bedrock 모델 호출 테스트 (us-east-1)
cat > /tmp/bedrock-test.json <<'EOF'
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 50,
  "messages": [{"role": "user", "content": "안녕"}]
}
EOF

aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id anthropic.claude-3-sonnet-20240229-v1:0 \
  --body file:///tmp/bedrock-test.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/bedrock-out.json 2>&1

cat /tmp/bedrock-out.json 2>/dev/null
```

**결과 해석:**

| 오류 메시지 | 원인 | 해결 |
|------------|------|------|
| `AccessDeniedException` + `bedrock:InvokeModel` | 역할에 권한 없음 | 3-4절 진행 |
| `ValidationException` + model not found | 모델 액세스 미신청 | 3-2절에서 신청 |
| `content` 필드에 한국어 응답 | ✅ 정상 | 진행 가능 |

---

### 0-5. Textract 권한 점검

```bash
aws textract detect-document-text \
  --document '{"S3Object":{"Bucket":"sgu-pj-01-littleboss-docs","Name":"uploads/perm-test.txt"}}' \
  --region ap-northeast-2 \
  2>&1 | head -5
```

**결과 해석:**

| 오류 메시지 | 원인 | 해결 |
|------------|------|------|
| `AccessDeniedException` | Textract 권한 없음 | 관리자 요청 필요 |
| `InvalidS3ObjectException` | 권한은 있으나 파일 형식 문제 | ✅ 권한 있음 |
| `Blocks` 포함 응답 | ✅ 정상 | 진행 가능 |

---

### 0-6. SNS 권한 점검

```bash
# SNS 토픽 생성 권한 확인
aws sns create-topic \
  --name sgu-pj-01-perm-test \
  --region ap-northeast-2 \
  2>&1

# 성공: {"TopicArn": "arn:aws:sns:..."}
# 실패: An error occurred (AuthorizationError)
```

> 성공했다면 테스트 토픽 삭제:
> ```bash
> aws sns delete-topic \
>   --topic-arn arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-01-perm-test \
>   --region ap-northeast-2
> ```

---

### 0-7. IAM 인라인 정책 추가 권한 점검 (Bedrock용)

```bash
aws iam put-role-policy \
  --role-name Nxt-Lambda-Basic-Role \
  --policy-name sgu-pj-01-bedrock-test \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel"],"Resource":"*"}]}' \
  2>&1

# 성공: (출력 없음)
# 실패: An error occurred (AccessDenied)
```

> 성공했다면 바로 정식 정책으로 교체합니다 (3-4절). 실패 시 → 관리자 요청.

---

### 0-8. 권한 점검 결과표 (직접 작성)

아래 표를 복사해 자신의 점검 결과를 기록하세요.

| 권한 | 상태 | 조치 |
|------|------|------|
| S3 PutObject / GetObject | ⬜ 확인 전 | 버킷 정책 (1-4절) |
| DynamoDB PutItem / Query | ⬜ 확인 전 | 리소스 정책 (2-4절) |
| Bedrock InvokeModel | ⬜ 확인 전 | 모델 활성화 + IAM (3단계) |
| Textract DetectDocumentText | ⬜ 확인 전 | 관리자 요청 |
| SNS Publish | ⬜ 확인 전 | 관리자 요청 or SNS 리소스 정책 |
| EventBridge CreateSchedule | ⬜ 확인 전 | 관리자 요청 |

> 🔴 Textract / SNS / EventBridge 권한이 없으면 핵심 기능(OCR, 알림)이 동작하지 않습니다. 셋업 전 관리자에게 아래 권한을 요청하세요.

**관리자 요청 정책 내용:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LittleBossAdditionalPermissions",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "textract:DetectDocumentText",
        "textract:StartDocumentTextDetection",
        "textract:GetDocumentTextDetection",
        "sns:Publish",
        "scheduler:CreateSchedule",
        "scheduler:DeleteSchedule"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 1단계: S3 버킷 생성

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

버킷 내에 3개 폴더 생성:

```
sgu-pj-01-littleboss-docs/
├── uploads/           ← 원본 업로드 파일
├── ocr-results/       ← OCR 추출 텍스트
└── analysis-results/  ← AI 분석 결과 JSON
```

1. `sgu-pj-01-littleboss-docs` 클릭
2. **폴더 만들기** → `uploads` → **폴더 만들기**
3. 같은 방식으로 `ocr-results`, `analysis-results` 폴더 생성

### 1-3. CORS 설정

1. 버킷 → **권한** 탭 → 맨 아래 **CORS(Cross-Origin 리소스 공유)** → **편집**
2. 아래 JSON 붙여넣기:

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

### 1-4. 버킷 정책 (Lambda S3 접근 권한)

> 🔑 `Nxt-Lambda-Basic-Role`에 S3 권한이 없으므로 버킷 정책으로 직접 허용합니다.

1. 버킷 → **권한** 탭 → **버킷 정책** → **편집**
2. 아래 JSON 붙여넣기 (AccountID `443370697536` 확인):

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

> 적용 후 0-2절 CloudShell 테스트로 확인.

### 1-5. 수명 주기 규칙 (선택)

1. 버킷 → **관리** 탭 → **수명 주기 규칙 생성**
2. 설정:
   - **규칙 이름**: `auto-delete-uploads`
   - **접두사 필터**: `uploads/`
   - **객체의 현재 버전 만료** 체크 → **30일**
3. **규칙 생성**

---

## 2단계: DynamoDB 테이블 생성

> 모두 **온디맨드 용량 모드**로 생성합니다.

### 2-1. users 테이블

1. DynamoDB → **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-users`
   - **파티션 키**: `user_id` (문자열)
   - **읽기/쓰기 용량**: 온디맨드
3. **테이블 생성**

### 2-2. documents 테이블 (메인)

1. **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-documents`
   - **파티션 키**: `doc_id` (문자열)
   - **정렬 키**: `user_id` (문자열)
   - **읽기/쓰기 용량**: 온디맨드
3. **테이블 생성**

#### GSI (Global Secondary Index) 추가

1. `sgu-pj-01-documents` → **인덱스** 탭 → **인덱스 생성**
2. 설정:
   - **파티션 키**: `user_id` (문자열)
   - **인덱스 이름**: `user_id-index`
   - **프로젝션 유형**: `모두`
3. **인덱스 생성**

### 2-3. checklists 테이블

1. **테이블 생성**
2. 설정:
   - **테이블 이름**: `sgu-pj-01-checklists`
   - **파티션 키**: `checklist_id` (문자열)
   - **읽기/쓰기 용량**: 온디맨드
3. **테이블 생성**

#### GSI 추가

1. `sgu-pj-01-checklists` → **인덱스** 탭 → **인덱스 생성**
2. 설정:
   - **파티션 키**: `doc_id` (문자열)
   - **인덱스 이름**: `doc_id-index`
   - **프로젝션 유형**: `모두`
3. **인덱스 생성**

### 2-4. DynamoDB 리소스 정책 (Lambda 접근 권한)

> 🔑 `Nxt-Lambda-Basic-Role`에 DynamoDB 권한이 없으므로 리소스 정책으로 허용합니다.

#### 방법 A: 콘솔

각 테이블 → **권한 탭** → **리소스 기반 정책** → 아래 JSON 적용 (테이블명 변경 후 3회 반복)

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

> `sgu-pj-01-users`, `sgu-pj-01-checklists`도 Resource ARN만 바꿔서 동일하게 적용.

#### 방법 B: CloudShell (콘솔에서 안 될 때)

```bash
# documents 테이블
cat > /tmp/dynamo-policy.json <<'EOF'
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
        "dynamodb:PutItem","dynamodb:GetItem","dynamodb:UpdateItem",
        "dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan",
        "dynamodb:DescribeStream","dynamodb:GetRecords",
        "dynamodb:GetShardIterator","dynamodb:ListStreams"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents",
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents/index/*",
        "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents/stream/*"
      ]
    }
  ]
}
EOF

aws dynamodb put-resource-policy \
  --resource-arn arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-01-documents \
  --policy file:///tmp/dynamo-policy.json \
  --region ap-northeast-2
```

> users, checklists도 `--resource-arn`과 policy 내 `Resource` ARN을 각각 교체해서 실행.

### 2-5. 확인

DynamoDB 목록에서 3개 테이블 **활성** 상태 확인:
- `sgu-pj-01-users`
- `sgu-pj-01-documents` (+ `user_id-index`)
- `sgu-pj-01-checklists` (+ `doc_id-index`)

---

## 3단계: Bedrock 모델 액세스 활성화

> ⚠️ **반드시 `us-east-1` 리전으로 변경 후 진행.** 학교 계정은 서울 리전에서 Bedrock 호출 불가.

### 3-1. 리전 변경

AWS 콘솔 우측 상단 → **미국 동부(버지니아 북부) `us-east-1`** 선택

### 3-2. 모델 액세스 신청

1. 콘솔 → **Amazon Bedrock** → 좌측 메뉴 **Model access**
2. 우측 상단 **Modify model access**
3. **Anthropic Claude 3 Sonnet** 체크
4. (선택) Claude 3 Haiku도 체크 (백업용)
5. **Next** → 사용 사례 입력: `Educational project for document analysis` → **Submit**

> 보통 즉시 활성화됩니다. 상태 "**Access granted**" 확인 후 다음 진행.

### 3-3. 활성화 확인 (CloudShell)

```bash
cat > /tmp/bedrock-test.json <<'EOF'
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 100,
  "messages": [{"role": "user", "content": "안녕"}]
}
EOF

aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id anthropic.claude-3-sonnet-20240229-v1:0 \
  --body file:///tmp/bedrock-test.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/bedrock-out.json && cat /tmp/bedrock-out.json
```

응답의 `content` 필드에 한국어 답변이 보이면 성공.

### 3-4. Lambda 역할에 Bedrock 권한 추가

#### 방법 A: CloudShell (IAM 수정 권한이 있을 때)

```bash
cat > /tmp/bedrock-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LittleBossBedrockInvoke",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
      ]
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name Nxt-Lambda-Basic-Role \
  --policy-name LittleBoss-Bedrock-Invoke \
  --policy-document file:///tmp/bedrock-policy.json
```

#### 방법 B: `Nxt-Lambda-Bedrock-Role`이 있다면 사용

학교 계정에 `Nxt-Lambda-Bedrock-Role`이 존재하는 경우, Lambda 함수 생성 시 실행 역할로 이 역할을 선택하면 별도 정책 추가 없이 Bedrock 호출 가능합니다.

```bash
# 역할 존재 여부 확인
aws iam get-role --role-name Nxt-Lambda-Bedrock-Role 2>&1
```

> ❌ 두 방법 모두 안 될 경우 → 0-8절의 정책 JSON을 첨부해 관리자에게 요청

---

## 4단계: Lambda 함수 생성 (4개)

### 공통 생성 절차

1. Lambda → **함수** → **함수 생성** (리전: **서울 ap-northeast-2**)
2. **새로 작성** 선택
3. 이름 / 런타임 입력
4. **실행 역할** → `기존 역할 사용` → **`Nxt-Lambda-Basic-Role`** 선택 ⚠️
5. **함수 생성** 후 일반 구성 / 환경 변수 편집

> **Lambda Layer 사용 안 함**: 학교 계정 정책으로 Layer 생성 차단. 새 아키텍처는 ai-analyzer도 boto3만 사용하므로 불필요.

---

### 4-1. `sgu-pj-01-upload-handler`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-upload-handler` |
| 런타임 | Python 3.11 |
| 아키텍처 | x86_64 |
| 타임아웃 | 30초 |
| 메모리 | 256 MB |
| 배포 방식 | 콘솔 인라인 |

**환경 변수:**

| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `ENV` | `production` |

---

### 4-2. `sgu-pj-01-ocr-handler`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-ocr-handler` |
| 런타임 | Python 3.11 |
| 타임아웃 | 1분 (Textract 처리 시간 고려) |
| 메모리 | 256 MB |
| 배포 방식 | 콘솔 인라인 |

**환경 변수:**

| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `ENV` | `production` |

> ⚠️ Textract 권한이 없으면 이 함수 실행 시 AccessDeniedException 발생. 0-5절 점검 결과 확인.

---

### 4-3. `sgu-pj-01-ai-analyzer` ⭐ Bedrock 사용

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-ai-analyzer` |
| 런타임 | Python 3.11 |
| 타임아웃 | 1분 |
| 메모리 | 256 MB |
| 배포 방식 | 콘솔 인라인 (boto3 내장) |

**환경 변수:**

| 키 | 값 |
|----|-----|
| `S3_BUCKET` | `sgu-pj-01-littleboss-docs` |
| `DOCUMENTS_TABLE` | `sgu-pj-01-documents` |
| `BEDROCK_REGION` | `us-east-1` ⭐ |
| `BEDROCK_MODEL_ID` | `anthropic.claude-3-sonnet-20240229-v1:0` ⭐ |
| `ENV` | `production` |

> ❌ `GEMINI_API_KEY` 더 이상 사용 안 함. Bedrock으로 대체됨.

---

### 4-4. `sgu-pj-01-action-executor`

| 항목 | 값 |
|------|-----|
| 함수 이름 | `sgu-pj-01-action-executor` |
| 런타임 | Python 3.11 |
| 타임아웃 | 30초 |
| 메모리 | 512 MB |
| 배포 방식 | **ZIP 업로드** (google-api-python-client 포함) |

**환경 변수:**

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

> ZIP 패키징 방법 → `LAMBDA_GUIDE.md` 참고

### 4-5. 확인

Lambda 함수 목록에서 4개 확인:
- `sgu-pj-01-upload-handler`
- `sgu-pj-01-ocr-handler`
- `sgu-pj-01-ai-analyzer`
- `sgu-pj-01-action-executor`

---

## 5단계: S3 → Lambda 트리거

### 5-1. 이벤트 알림 생성

1. S3 → `sgu-pj-01-littleboss-docs` → **속성** 탭
2. 아래로 스크롤 → **이벤트 알림 생성**
3. 설정:
   - **이벤트 이름**: `trigger-ocr-on-upload`
   - **접두사**: `uploads/`
   - **이벤트 유형**: 모든 객체 생성 이벤트
   - **대상**: Lambda 함수 → `sgu-pj-01-ocr-handler`
4. **변경 사항 저장**

### 5-2. 확인

`sgu-pj-01-ocr-handler` → **구성** → **트리거** 탭에 S3 트리거 표시 확인

---

## 6단계: DynamoDB Streams → Lambda 트리거

### 6-1. Streams 활성화

1. DynamoDB → `sgu-pj-01-documents` → **내보내기 및 스트림** 탭
2. **DynamoDB 스트림 세부 정보** → **활성화**
3. **보기 유형**: `새 이미지 및 이전 이미지` (NEW_AND_OLD_IMAGES)
4. **스트림 활성화**

### 6-2. 트리거 연결

1. 같은 페이지 **트리거** 섹션 → **트리거 생성**
2. 설정:
   - **Lambda 함수**: `sgu-pj-01-ai-analyzer`
   - **배치 크기**: `1`
   - **시작 위치**: `최신`
3. **트리거 생성**

### 6-3. 확인

`sgu-pj-01-ai-analyzer` → **구성** → **트리거** 탭에 DynamoDB 트리거 표시 확인

> ai-analyzer Lambda는 `status == "ocr_done"`인 경우에만 처리 (무한 루프 방지)

---

## 7단계: API Gateway

### 7-1. API 생성

1. API Gateway → **API 생성** → **REST API** → **구축**
2. 설정:
   - **API 이름**: `sgu-pj-01-littleboss-api`
   - **엔드포인트 유형**: 리전
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

**리소스 생성 예시 (`/upload`):**
1. `/` 선택 → **리소스 생성**
2. **리소스 이름**: `upload` → **CORS 활성화** 체크 → **리소스 생성**

**메서드 생성 예시 (POST /upload):**
1. `/upload` 선택 → **메서드 생성**
2. 설정:
   - **메서드 유형**: POST
   - **통합 유형**: Lambda 함수
   - **Lambda 프록시 통합**: ✅ 체크
   - **Lambda 함수**: `sgu-pj-01-upload-handler`
3. **메서드 생성**

### 7-3. CORS 헤더 (Lambda 응답 필수)

Lambda 프록시 통합이므로 Lambda 코드에 CORS 헤더 포함 필수:

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

1. **API 배포** 클릭
2. **스테이지**: 새 스테이지 → 이름 `prod`
3. **배포**

### 7-5. API URL 확인

배포 후 **호출 URL** 복사 → 프론트엔드 `.env`의 `REACT_APP_API_URL` 설정:

```
https://{api-id}.execute-api.ap-northeast-2.amazonaws.com/prod
```

---

## 8단계: SNS 토픽 + 이메일 구독

> ⚠️ **`sns:DeleteTopic` 권한이 없으므로 이름을 신중히 입력하세요. 잘못 만들면 삭제 불가.**

### 8-1. SNS 토픽 생성

1. SNS → **주제** → **주제 생성**
2. 설정:
   - **유형**: 표준
   - **이름**: `sgu-pj-01-deadline-alerts`
3. **주제 생성**
4. **ARN 복사**: `arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-01-deadline-alerts`

### 8-2. 이메일 구독 추가

1. 토픽 상세 → **구독 생성**
2. **프로토콜**: 이메일 / **엔드포인트**: 수신 이메일 주소
3. 받은 편지함에서 **Confirm subscription** 링크 클릭

### 8-3. Lambda 환경변수 업데이트

`sgu-pj-01-action-executor` → **구성** → **환경 변수** → `SNS_TOPIC_ARN` 값 입력

> SNS Publish 권한 없으면 런타임에서 실패. 0-6절 점검 결과 확인.

---

## 9단계: EventBridge 스케줄 그룹

### 9-1. 스케줄 그룹 생성

1. EventBridge → **스케줄러** → **스케줄 그룹** → **그룹 생성**
2. **이름**: `sgu-pj-01-littleboss-reminders`
3. **그룹 생성**

실제 스케줄은 action-executor 코드에서 동적으로 생성합니다.

> ⚠️ `scheduler:CreateSchedule` 권한 없으면 런타임에서 실패. 0-8절 확인.

---

## 10단계: S3 정적 호스팅 (프론트엔드)

### 10-1. 프론트엔드 버킷 생성

1. S3 → **버킷 만들기**
2. 설정:
   - **버킷 이름**: `sgu-pj-01-littleboss-frontend`
   - **리전**: ap-northeast-2
   - **모든 퍼블릭 액세스 차단** → **체크 해제** (경고 확인 포함)
3. **버킷 만들기**

### 10-2. 정적 웹사이트 호스팅 활성화

1. 버킷 → **속성** 탭 → 맨 아래 **정적 웹사이트 호스팅** → **편집**
2. 설정:
   - 활성화
   - **인덱스 문서**: `index.html`
   - **오류 문서**: `index.html`
3. **변경 사항 저장**

### 10-3. 버킷 정책 (퍼블릭 읽기)

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

### 10-4. 프론트엔드 빌드 & 배포

CloudShell에서:
```bash
cd frontend
npm run build
aws s3 sync build/ s3://sgu-pj-01-littleboss-frontend --delete
```

### 10-5. 접속 URL

```
http://sgu-pj-01-littleboss-frontend.s3-website.ap-northeast-2.amazonaws.com
```

---

## 최종 점검 체크리스트

| # | 확인 항목 | 방법 |
|---|----------|------|
| 1 | S3 버킷 2개 존재 | docs, frontend 버킷 |
| 2 | S3 버킷 정책 적용됨 | docs 버킷 → 권한 → 버킷 정책 |
| 3 | DynamoDB 테이블 3개 활성 | users, documents, checklists |
| 4 | DynamoDB 리소스 정책 적용됨 | 각 테이블 → 권한 탭 |
| 5 | **Bedrock 모델 액세스 활성화** | us-east-1 → Bedrock → Model access |
| 6 | **Bedrock InvokeModel 권한 있음** | IAM → Nxt-Lambda-Basic-Role 또는 CloudShell 점검 |
| 7 | Lambda 함수 4개 존재 | upload, ocr, ai-analyzer, action-executor |
| 8 | 모든 Lambda가 올바른 역할 사용 | 구성 → 권한 탭 |
| 9 | S3 트리거 동작 | 파일 업로드 → CloudWatch Logs에 ocr-handler 로그 |
| 10 | DynamoDB Streams 트리거 동작 | status 변경 → ai-analyzer 실행 로그 |
| 11 | API Gateway 호출 가능 | `{API URL}/prod/health` 브라우저 접속 |
| 12 | SNS 이메일 구독 "확인됨" | SNS → 구독 상태 |
| 13 | 프론트엔드 접속 가능 | S3 웹사이트 URL |

---

## 환경변수 총정리

```
[sgu-pj-01-upload-handler]
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
ENV                 = production

[sgu-pj-01-ocr-handler]
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
ENV                 = production

[sgu-pj-01-ai-analyzer]
S3_BUCKET           = sgu-pj-01-littleboss-docs
DOCUMENTS_TABLE     = sgu-pj-01-documents
BEDROCK_REGION      = us-east-1
BEDROCK_MODEL_ID    = anthropic.claude-3-sonnet-20240229-v1:0
ENV                 = production

[sgu-pj-01-action-executor]
CHECKLISTS_TABLE    = sgu-pj-01-checklists
USERS_TABLE         = sgu-pj-01-users
DOCUMENTS_TABLE     = sgu-pj-01-documents
GOOGLE_CLIENT_ID    = (실제 ID)
GOOGLE_CLIENT_SECRET= (실제 Secret)
SNS_TOPIC_ARN       = arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-01-deadline-alerts
SCHEDULE_GROUP      = sgu-pj-01-littleboss-reminders
ENV                 = production
```

---

## Bedrock Cross-Region 호출 패턴

```
[서울 ap-northeast-2]                    [버지니아 us-east-1]
┌─────────────────────┐                 ┌──────────────────────┐
│  Lambda ai-analyzer │──invoke_model──→│  Bedrock             │
│  region=us-east-1   │←────응답────────│  Claude 3 Sonnet     │
└─────────────────────┘                 └──────────────────────┘
```

핵심 코드:
```python
bedrock = boto3.client('bedrock-runtime', region_name=os.environ['BEDROCK_REGION'])
```

---

## 트러블슈팅

### 리소스 생성 시 "AccessDenied" / "explicit deny"
→ 리소스 이름에 `sgu-pj-01-` 접두사가 붙었는지 확인. 없으면 생성 불가.

### Lambda 실행 시 "AccessDenied" (CloudWatch Logs)
→ 0단계 권한 점검으로 어떤 권한이 없는지 확인.
→ S3 / DynamoDB → 리소스 기반 정책으로 해결 (1-4, 2-4절).
→ Bedrock / Textract / SNS / Scheduler → IAM 인라인 정책 시도, 거부 시 관리자 요청.

### Bedrock InvokeModel 실패: AccessDenied
→ 모델 액세스 활성화 여부 확인 (3-2절).
→ Lambda 역할에 `bedrock:InvokeModel` 있는지 확인 (3-4절).
→ 호출 리전이 `us-east-1`인지 확인.

### Bedrock InvokeModel 실패: ValidationException
→ 모델 ID 오타 확인: `anthropic.claude-3-sonnet-20240229-v1:0`
→ request body가 Claude Messages API 형식인지 확인.

### Textract 호출 실패: AccessDenied
→ `textract:DetectDocumentText` 권한 없음. 0-8절 정책을 관리자에게 요청.

### SNS Publish 실패
→ `sns:Publish` 권한 부족. 0-8절 정책 관리자 요청.

### EventBridge 스케줄 생성 실패
→ `scheduler:CreateSchedule` 권한 부족. 0-8절 정책 관리자 요청.

### DynamoDB Streams 트리거 미동작
→ 스트림 보기 유형이 `NEW_AND_OLD_IMAGES`인지 확인 (6-1절).
→ ai-analyzer 트리거 배치 크기 1, 시작 위치 최신인지 확인.

### S3 트리거 미동작
→ 이벤트 알림 접두사가 `uploads/`인지 확인.

### API Gateway CORS 오류
→ Lambda 응답에 `Access-Control-Allow-Origin` 헤더가 있는지 확인.
