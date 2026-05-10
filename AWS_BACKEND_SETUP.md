# LittleBoss — AWS 백엔드 세팅 가이드

> 업데이트: 2026-04-28 | 계정: `sgu-pj-03` | 리전: `ap-northeast-2` / Bedrock: `us-east-1`
> 모든 CLI 명령은 **AWS CloudShell**에서 실행 (Access Key 발급 불가)

---

## 현재 상태

| 리소스 | 이름 | 상태 |
|--------|------|------|
| IAM Role | `SafeRole-sgu-pj` | ✅ 제공됨 |
| S3 버킷 | `sgu-pj-03-littleboss-docs` | ⬜ 생성 필요 |
| DynamoDB | `sgu-pj-03-documents` | ⬜ 생성 필요 |
| DynamoDB | `sgu-pj-03-users` | ⬜ 생성 필요 |
| DynamoDB | `sgu-pj-03-checklists` | ⬜ 생성 필요 |
| Lambda Layer | `sgu-pj-03-dependencies` | ⬜ 생성 필요 |
| Lambda | `sgu-pj-03-upload-handler` | ⬜ 생성 필요 |
| Lambda | `sgu-pj-03-ocr-handler` | ⬜ 생성 필요 |
| Lambda | `sgu-pj-03-ai-analyzer` | ⬜ 생성 필요 |
| Lambda | `sgu-pj-03-action-executor` | ⬜ 생성 필요 |
| API Gateway | `sgu-pj-03-api` | ⬜ 생성 필요 |
| SNS | `sgu-pj-03-deadline-alerts` | ⬜ 생성 필요 |

**제약사항**
- Access Key 발급 불가 → CLI는 CloudShell 전용
- Bedrock: `ap-northeast-2` 차단 → `us-east-1` 사용
- S3 버킷명 반드시 `sgu-pj`로 시작

---

## Step 1 — S3 버킷 생성

```bash
aws s3 mb s3://sgu-pj-03-littleboss-docs --region ap-northeast-2

# 퍼블릭 액세스 차단
aws s3api put-public-access-block \
  --bucket sgu-pj-03-littleboss-docs \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# CORS 설정
aws s3api put-bucket-cors \
  --bucket sgu-pj-03-littleboss-docs \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET","PUT","POST"],
      "AllowedOrigins": ["http://localhost:3000","*"],
      "ExposeHeaders": ["ETag"]
    }]
  }'
```

---

## Step 2 — DynamoDB 테이블 3개 생성

```bash
# (1) users
aws dynamodb create-table \
  --table-name sgu-pj-03-users \
  --attribute-definitions AttributeName=user_id,AttributeType=S \
  --key-schema AttributeName=user_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-2

# (2) documents (Streams + GSI 포함)
aws dynamodb create-table \
  --table-name sgu-pj-03-documents \
  --attribute-definitions \
    AttributeName=doc_id,AttributeType=S \
    AttributeName=user_id,AttributeType=S \
    AttributeName=created_at,AttributeType=S \
  --key-schema AttributeName=doc_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE \
  --global-secondary-indexes '[{
    "IndexName": "user_id-index",
    "KeySchema": [
      {"AttributeName":"user_id","KeyType":"HASH"},
      {"AttributeName":"created_at","KeyType":"RANGE"}
    ],
    "Projection": {"ProjectionType":"ALL"}
  }]' \
  --region ap-northeast-2

# (3) checklists (GSI 포함)
aws dynamodb create-table \
  --table-name sgu-pj-03-checklists \
  --attribute-definitions \
    AttributeName=checklist_id,AttributeType=S \
    AttributeName=doc_id,AttributeType=S \
  --key-schema AttributeName=checklist_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "doc_id-index",
    "KeySchema": [{"AttributeName":"doc_id","KeyType":"HASH"}],
    "Projection": {"ProjectionType":"ALL"}
  }]' \
  --region ap-northeast-2
```

---

## Step 3 — Lambda Layer 생성

CloudShell에서 실행 (약 2~3분 소요):

```bash
mkdir -p python
pip install google-api-python-client google-auth google-auth-oauthlib requests -t python/ --quiet
zip -r sgu-pj-03-layer.zip python/

aws lambda publish-layer-version \
  --layer-name sgu-pj-03-dependencies \
  --zip-file fileb://sgu-pj-03-layer.zip \
  --compatible-runtimes python3.11 \
  --region ap-northeast-2
```

> 출력된 `LayerVersionArn` 메모 (Step 4에서 사용)
> boto3, Textract, Bedrock SDK는 Lambda 런타임 기본 포함

---

## Step 4 — Lambda 함수 4개 생성

### 코드 패키지 준비

**로컬 PowerShell에서 zip 생성:**
```powershell
cd "C:\univercity\Project (Cab Stone)\littleboss\backend"
Compress-Archive -Path handlers\upload_handler.py,utils\,models\ -DestinationPath upload-handler.zip -Force
Compress-Archive -Path handlers\ocr_handler.py,utils\,models\ -DestinationPath ocr-handler.zip -Force
Compress-Archive -Path handlers\ai_handler.py,utils\,models\ -DestinationPath ai-analyzer.zip -Force
Compress-Archive -Path handlers\action_handler.py,utils\,models\ -DestinationPath action-executor.zip -Force
```

**AWS 콘솔에서 S3 업로드:**
S3 → `sgu-pj-03-littleboss-docs` → `deployments/` 폴더 생성 → zip 4개 업로드

### Lambda 함수 생성 (CloudShell)

`LAYER_ARN`을 Step 3 출력값으로 교체:

```bash
LAYER_ARN="arn:aws:lambda:ap-northeast-2:443370697536:layer:sgu-pj-03-dependencies:1"
ROLE_ARN="arn:aws:iam::443370697536:role/SafeRole-sgu-pj"
BUCKET="sgu-pj-03-littleboss-docs"
REGION="ap-northeast-2"

# (1) upload-handler
aws lambda create-function \
  --function-name sgu-pj-03-upload-handler \
  --runtime python3.11 \
  --role $ROLE_ARN \
  --handler upload_handler.handle \
  --code S3Bucket=$BUCKET,S3Key=deployments/upload-handler.zip \
  --memory-size 256 --timeout 30 \
  --layers $LAYER_ARN \
  --environment 'Variables={
    ENV=production,
    S3_BUCKET=sgu-pj-03-littleboss-docs,
    DOCUMENTS_TABLE=sgu-pj-03-documents,
    USERS_TABLE=sgu-pj-03-users
  }' \
  --region $REGION

# (2) ocr-handler
aws lambda create-function \
  --function-name sgu-pj-03-ocr-handler \
  --runtime python3.11 \
  --role $ROLE_ARN \
  --handler ocr_handler.handle \
  --code S3Bucket=$BUCKET,S3Key=deployments/ocr-handler.zip \
  --memory-size 256 --timeout 60 \
  --layers $LAYER_ARN \
  --environment 'Variables={
    ENV=production,
    S3_BUCKET=sgu-pj-03-littleboss-docs,
    DOCUMENTS_TABLE=sgu-pj-03-documents
  }' \
  --region $REGION

# (3) ai-analyzer
aws lambda create-function \
  --function-name sgu-pj-03-ai-analyzer \
  --runtime python3.11 \
  --role $ROLE_ARN \
  --handler ai_handler.handle \
  --code S3Bucket=$BUCKET,S3Key=deployments/ai-analyzer.zip \
  --memory-size 256 --timeout 60 \
  --layers $LAYER_ARN \
  --environment 'Variables={
    ENV=production,
    AI_PROVIDER=bedrock,
    BEDROCK_REGION=us-east-1,
    BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0,
    S3_BUCKET=sgu-pj-03-littleboss-docs,
    DOCUMENTS_TABLE=sgu-pj-03-documents
  }' \
  --region $REGION

# (4) action-executor
aws lambda create-function \
  --function-name sgu-pj-03-action-executor \
  --runtime python3.11 \
  --role $ROLE_ARN \
  --handler action_handler.handle \
  --code S3Bucket=$BUCKET,S3Key=deployments/action-executor.zip \
  --memory-size 256 --timeout 30 \
  --layers $LAYER_ARN \
  --environment 'Variables={
    ENV=production,
    DOCUMENTS_TABLE=sgu-pj-03-documents,
    USERS_TABLE=sgu-pj-03-users,
    CHECKLISTS_TABLE=sgu-pj-03-checklists,
    SNS_TOPIC_ARN=arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-03-deadline-alerts
  }' \
  --region $REGION
```

---

## Step 5 — 트리거 설정

### S3 → ocr-handler

```bash
# S3가 Lambda 호출할 수 있도록 권한 부여
aws lambda add-permission \
  --function-name sgu-pj-03-ocr-handler \
  --statement-id s3-trigger \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::sgu-pj-03-littleboss-docs \
  --region ap-northeast-2

# S3 이벤트 알림 설정
aws s3api put-bucket-notification-configuration \
  --bucket sgu-pj-03-littleboss-docs \
  --notification-configuration '{
    "LambdaFunctionConfigurations": [{
      "LambdaFunctionArn": "arn:aws:lambda:ap-northeast-2:443370697536:function:sgu-pj-03-ocr-handler",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {"Key": {"FilterRules": [{"Name":"prefix","Value":"uploads/"}]}}
    }]
  }'
```

### DynamoDB Streams → ai-analyzer

```bash
# Streams ARN 조회
STREAM_ARN=$(aws dynamodb describe-table \
  --table-name sgu-pj-03-documents \
  --region ap-northeast-2 \
  --query 'Table.LatestStreamArn' --output text)

# 트리거 연결
aws lambda create-event-source-mapping \
  --function-name sgu-pj-03-ai-analyzer \
  --event-source-arn $STREAM_ARN \
  --batch-size 1 \
  --starting-position LATEST \
  --region ap-northeast-2
```

---

## Step 6 — SNS 토픽 생성

```bash
aws sns create-topic \
  --name sgu-pj-03-deadline-alerts \
  --region ap-northeast-2

# 이메일 구독 (본인 이메일로 변경)
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-03-deadline-alerts \
  --protocol email \
  --notification-endpoint 본인이메일@gmail.com \
  --region ap-northeast-2
```

---

## Step 7 — API Gateway 생성

콘솔에서 진행 권장 (AWS 콘솔 → API Gateway → REST API 구축)

API 이름: `sgu-pj-03-api`

| 메서드 | 경로 | 연결 Lambda |
|--------|------|-------------|
| GET | `/health` | `sgu-pj-03-upload-handler` |
| POST | `/upload` | `sgu-pj-03-upload-handler` |
| GET | `/documents` | `sgu-pj-03-upload-handler` |
| GET | `/documents/{doc_id}` | `sgu-pj-03-upload-handler` |
| POST | `/calendar/{doc_id}` | `sgu-pj-03-action-executor` |
| GET | `/checklist/{doc_id}` | `sgu-pj-03-action-executor` |
| PATCH | `/checklist/{doc_id}` | `sgu-pj-03-action-executor` |

- 각 리소스마다 CORS 활성화
- `prod` 스테이지로 배포
- 최종 URL: `https://{API_ID}.execute-api.ap-northeast-2.amazonaws.com/prod`

---

## 환경변수 총정리 (Lambda 콘솔 설정값)

| 변수 | 값 | 적용 Lambda |
|------|----|-------------|
| `ENV` | `production` | 전체 |
| `S3_BUCKET` | `sgu-pj-03-littleboss-docs` | upload, ocr, analyzer |
| `DOCUMENTS_TABLE` | `sgu-pj-03-documents` | upload, ocr, analyzer |
| `USERS_TABLE` | `sgu-pj-03-users` | upload, action |
| `CHECKLISTS_TABLE` | `sgu-pj-03-checklists` | action |
| `AI_PROVIDER` | `bedrock` | ai-analyzer |
| `BEDROCK_REGION` | `us-east-1` | ai-analyzer |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | ai-analyzer |
| `GOOGLE_CLIENT_ID` | Google Cloud Console 발급 | action |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console 발급 | action |
| `SNS_TOPIC_ARN` | `arn:aws:sns:ap-northeast-2:443370697536:sgu-pj-03-deadline-alerts` | action |

---

## 전체 체크리스트

```
[ ] Step 1: S3 버킷 sgu-pj-03-littleboss-docs 생성
[ ] Step 2: DynamoDB 테이블 3개 생성 (Streams + GSI 포함)
[ ] Step 3: Lambda Layer sgu-pj-03-dependencies 생성
[ ] Step 4: Lambda 함수 4개 생성
[ ] Step 5: S3 트리거 + DynamoDB Streams 트리거 연결
[ ] Step 6: SNS 토픽 생성 + 이메일 구독
[ ] Step 7: API Gateway 생성 + 7개 엔드포인트 + prod 배포
[ ] Step 8: 프론트엔드 API URL 업데이트 후 E2E 테스트
```
