# LittleBoss Lambda 설정 가이드

팀원 공유용 — Lambda 함수 생성부터 트리거 연결까지 단계별 설명

> **학교 제공 AWS 계정 (`sgu-pj-01`)** 용으로 조정됨.
> - 모든 리소스 이름에 `sgu-pj-01-` 접두사 필수
> - IAM 역할 생성 불가 → 기존 **`Nxt-Lambda-Basic-Role`** 재사용
> - **Lambda Layer 생성 불가** (`ControlOnlyOwnResource` 정책으로 명시적 거부)
>   → 패키지가 필요한 함수는 **코드 zip에 직접 포함**시켜 배포

---

## 목차
1. [Lambda란?](#1-lambda란)
2. [우리 프로젝트의 Lambda 구조](#2-우리-프로젝트의-lambda-구조)
3. [사전 준비](#3-사전-준비)
4. [Step 1: Lambda 실행 역할 확인](#4-step-1-lambda-실행-역할-확인)
5. [Step 2: 패키지 준비 전략](#5-step-2-패키지-준비-전략)
6. [Step 3: Lambda 함수 생성](#6-step-3-lambda-함수-생성)
7. [Step 4: 코드 배포](#7-step-4-코드-배포)
8. [Step 5: 트리거 연결](#8-step-5-트리거-연결)
9. [Step 6: 테스트](#9-step-6-테스트)
10. [트러블슈팅](#10-트러블슈팅)

---

## 1. Lambda란?

Lambda는 **서버 없이 코드를 실행**하는 AWS 서비스입니다.

```
[일반 서버]
서버 구매 → OS 설치 → Python 설치 → Flask 실행 → 24시간 켜놓기 → 요금 계속 발생

[Lambda]
코드만 업로드 → 요청이 올 때만 실행 → 안 쓰면 요금 0원
```

### 핵심 특징
- **이벤트 기반**: 누군가 API를 호출하거나, S3에 파일이 올라가면 자동 실행
- **자동 스케일링**: 동시에 100명이 요청해도 자동으로 100개 실행
- **제한**: 최대 실행 시간 15분, 메모리 최대 10GB

### Lambda 함수의 기본 구조 (Python)

```python
def lambda_handler(event, context):
    # event: 트리거에서 전달하는 데이터
    # context: Lambda 실행 환경 정보
    result = do_something(event)
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

---

## 2. 우리 프로젝트의 Lambda 구조

### 전체 비동기 파이프라인

```
사용자가 파일 업로드
        │
        ▼
┌─────────────────────┐
│  Upload Handler     │ ← API Gateway (POST /upload)
│  - S3에 파일 저장    │
│  - DynamoDB 레코드   │
│  - 즉시 doc_id 반환  │
└────────┬────────────┘
         │ S3에 파일이 생성됨 (자동 트리거)
         ▼
┌─────────────────────┐
│  OCR Handler        │ ← S3 이벤트 (자동 실행)
│  - Textract OCR     │
│  - 결과 S3 저장     │
│  - 상태: "ocr_done" │
└────────┬────────────┘
         │ DynamoDB 상태가 변경됨 (자동 트리거)
         ▼
┌─────────────────────┐
│  AI Analyzer        │ ← DynamoDB Streams (자동 실행)
│  - Gemini API 호출  │
│  - 분석 결과 저장    │
│  - 상태: "done"     │
└────────┬────────────┘
         │ 사용자가 결과 확인 후 버튼 클릭
         ▼
┌─────────────────────┐
│  Action Executor    │ ← API Gateway (POST /calendar)
│  - 캘린더 등록      │
│  - 체크리스트 저장   │
│  - 알림 설정        │
└─────────────────────┘
```

### Lambda 함수 요약표

| 함수명 | 트리거 | 타임아웃 | 외부 패키지 | 배포 방식 |
|--------|--------|---------|------------|----------|
| `sgu-pj-01-upload-handler` | API Gateway | 30초 | boto3 (내장) | **콘솔 인라인** |
| `sgu-pj-01-ocr-handler` | S3 이벤트 | 60초 | boto3 (내장) | **콘솔 인라인** |
| `sgu-pj-01-ai-analyzer` | DynamoDB Streams | 60초 | boto3 (내장, Bedrock 호출) | **콘솔 인라인** ⭐ |
| `sgu-pj-01-action-executor` | API Gateway | 30초 | google-api-python-client | **ZIP 업로드** |

> 💡 `boto3`는 Lambda Python 런타임에 기본 내장되어 있어 별도 설치 불필요.
> 새 아키텍처에서는 ai-analyzer가 Bedrock(boto3 내장)을 사용하므로 **action-executor만 ZIP 패키징**이 필요합니다.

---

## 3. 사전 준비

- [x] AWS 콘솔 로그인 (`sgu-pj-01` 계정)
- [x] Lambda 실행 역할 확인 (`Nxt-Lambda-Basic-Role` — Step 1에서 확인)
- [ ] S3 버킷 생성 (`sgu-pj-01-littleboss-docs`)
- [ ] DynamoDB 테이블 생성 (Streams 활성화 포함)

---

## 4. Step 1: Lambda 실행 역할 확인

> ⚠️ 학교 계정은 IAM 역할을 직접 만들 수 없습니다. 기존 `Nxt-Lambda-Basic-Role`을 재사용합니다.

### 4.1 사용할 역할 정보

| 항목 | 값 |
|------|-----|
| 역할 이름 | `Nxt-Lambda-Basic-Role` |
| 역할 ARN | `arn:aws:iam::443370697536:role/Nxt-Lambda-Basic-Role` |

### 4.2 역할 존재 확인

CloudShell에서:
```bash
aws iam list-roles --no-cli-pager \
  --query "Roles[?contains(AssumeRolePolicyDocument.Statement[0].Principal.Service, 'lambda')].RoleName"
```

출력에 `Nxt-Lambda-Basic-Role`이 보이면 준비 완료.

### 4.3 권한 부족 시 대응

Lambda 실행 후 CloudWatch Logs에서 권한 오류 발생 시 관리자에게 요청:

```
필요 권한 (LittleBoss 런타임 기준):
- s3:GetObject, s3:PutObject, s3:ListBucket  (sgu-pj-01-* 버킷)
- dynamodb:PutItem, GetItem, UpdateItem, Query, Scan
- dynamodb:DescribeStream, GetRecords, GetShardIterator, ListStreams
- textract:AnalyzeDocument, StartDocumentAnalysis, GetDocumentAnalysis
- sns:Publish (sgu-pj-01-* 토픽)
- scheduler:CreateSchedule, GetSchedule, DeleteSchedule
- logs:CreateLogGroup, CreateLogStream, PutLogEvents
```

---

## 5. Step 2: 패키지 준비 전략

### 5.1 왜 Layer를 사용하지 않는가?

원래 외부 패키지는 Lambda Layer로 묶어 여러 함수가 공유합니다. 하지만 이 계정은 `ControlOnlyOwnResource` 정책으로 **`lambda:PublishLayerVersion` 액션이 명시적으로 거부**되어 있습니다.

대신 **각 함수의 zip에 패키지를 직접 포함**시켜 배포합니다.

### 5.2 패키지가 필요한 함수와 불필요한 함수

| 함수 | 외부 패키지 | 준비 작업 |
|------|------------|----------|
| upload-handler | 없음 (boto3는 내장) | 콘솔에서 코드 붙여넣기 |
| ocr-handler | 없음 (boto3 내장) | 콘솔에서 코드 붙여넣기 |
| ai-analyzer | 없음 (Bedrock = boto3 내장) ⭐ | 콘솔에서 코드 붙여넣기 |
| **action-executor** | google-api-python-client, google-auth | CloudShell에서 zip 빌드 후 업로드 |

> ⭐ Gemini → Bedrock 전환으로 ai-analyzer도 외부 패키지가 필요 없어졌습니다.

### 5.3 CloudShell에서 작업 디렉토리 준비

```bash
rm -rf ~/lambda-build
mkdir -p ~/lambda-build
cd ~/lambda-build
```

### 5.4 action-executor 패키지 설치

```bash
mkdir -p ~/lambda-build/action-executor
cd ~/lambda-build/action-executor

pip install google-api-python-client google-auth google-auth-oauthlib -t .
```

> `-t .` 옵션으로 현재 폴더에 패키지를 설치합니다.

### 5.5 폴더 상태 확인

```bash
ls ~/lambda-build/
# action-executor
```

---

## 6. Step 3: Lambda 함수 생성

**콘솔에서 4개 함수를 모두 먼저 생성**합니다. 코드는 그 다음 단계에서 업로드합니다.

### 6.1 함수 생성 공통 절차

```
1. AWS 콘솔 > Lambda > 함수 > "함수 생성" 클릭

2. 기본 설정
   → "새로 작성" 선택
   → 함수 이름: (아래 표 참고) — sgu-pj-01- 접두사 필수
   → 런타임: Python 3.11
   → 아키텍처: x86_64

3. 기본 실행 역할 변경
   → "기존 역할 사용" 선택
   → 역할: Nxt-Lambda-Basic-Role ⚠️

4. "함수 생성" 클릭

5. 생성 후 "구성" 탭에서 타임아웃, 메모리, 환경변수 설정
```

### 6.2 함수별 설정

#### (1) sgu-pj-01-upload-handler
| 항목 | 값 |
|------|-----|
| 타임아웃 | 30초 |
| 메모리 | 256 MB |
| 환경변수 | `S3_BUCKET=sgu-pj-01-littleboss-docs`, `DOCUMENTS_TABLE=sgu-pj-01-documents`, `ENV=production` |

#### (2) sgu-pj-01-ocr-handler
| 항목 | 값 |
|------|-----|
| 타임아웃 | 60초 |
| 메모리 | 256 MB |
| 환경변수 | `S3_BUCKET=sgu-pj-01-littleboss-docs`, `DOCUMENTS_TABLE=sgu-pj-01-documents` |

#### (3) sgu-pj-01-ai-analyzer ⭐ (Bedrock 사용)
| 항목 | 값 |
|------|-----|
| 타임아웃 | 60초 |
| 메모리 | 256 MB (boto3만 사용하므로 가벼움) |
| 환경변수 | `BEDROCK_REGION=us-east-1`, `BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0`, `S3_BUCKET=sgu-pj-01-littleboss-docs`, `DOCUMENTS_TABLE=sgu-pj-01-documents` |

#### (4) sgu-pj-01-action-executor
| 항목 | 값 |
|------|-----|
| 타임아웃 | 30초 |
| 메모리 | 512 MB |
| 환경변수 | `CHECKLISTS_TABLE=sgu-pj-01-checklists`, `USERS_TABLE=sgu-pj-01-users`, `GOOGLE_CLIENT_ID=****`, `GOOGLE_CLIENT_SECRET=****`, `SNS_TOPIC_ARN=****`, `SCHEDULE_GROUP=sgu-pj-01-littleboss-reminders` |

---

## 7. Step 4: 코드 배포

### 7.1 패키지 불필요한 2개 함수 (콘솔 인라인 배포)

#### `sgu-pj-01-upload-handler`

1. Lambda → `sgu-pj-01-upload-handler` → **코드** 탭
2. 우측 편집기에서 기본 코드를 모두 지우고 아래 코드 붙여넣기
3. 상단 **Deploy** 버튼 클릭

```python
import json
import uuid
import boto3
import os
import base64
from datetime import datetime

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DOCUMENTS_TABLE'])

def lambda_handler(event, context):
    http_method = event.get('httpMethod', '')
    path = event.get('path', '')

    if http_method == 'POST' and '/upload' in path:
        return handle_upload(event)
    if http_method == 'GET' and '/documents/' in path:
        return handle_get_document(event)
    if http_method == 'GET' and '/documents' in path:
        return handle_list_documents(event)

    return response(404, {'error': 'Not Found'})

def handle_upload(event):
    doc_id = str(uuid.uuid4())
    body = json.loads(event.get('body', '{}'))
    file_content = base64.b64decode(body.get('file', ''))
    file_name = body.get('filename', 'unknown')

    s3_key = f"uploads/{doc_id}/{file_name}"
    s3.put_object(Bucket=os.environ['S3_BUCKET'], Key=s3_key, Body=file_content)

    table.put_item(Item={
        'doc_id': doc_id,
        'user_id': body.get('user_id', 'anonymous'),
        's3_key': s3_key,
        'status': 'uploaded',
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat()
    })

    return response(200, {
        'doc_id': doc_id,
        'status': 'uploaded',
        'message': '파일 업로드 완료. 분석이 자동으로 시작됩니다.'
    })

def handle_get_document(event):
    doc_id = event.get('pathParameters', {}).get('doc_id', '')
    result = table.get_item(Key={'doc_id': doc_id})
    item = result.get('Item')
    if not item:
        return response(404, {'error': '문서를 찾을 수 없습니다'})
    return response(200, item)

def handle_list_documents(event):
    return response(200, {'documents': []})

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        'body': json.dumps(body, default=str, ensure_ascii=False)
    }
```

#### `sgu-pj-01-ocr-handler`

같은 방식으로 코드 탭에 붙여넣고 **Deploy**:

```python
import json
import boto3
import os
from datetime import datetime

s3 = boto3.client('s3')
textract = boto3.client('textract')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DOCUMENTS_TABLE'])

def lambda_handler(event, context):
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']

        parts = key.split('/')
        if len(parts) < 3:
            continue
        doc_id = parts[1]

        print(f"OCR 시작: doc_id={doc_id}, key={key}")
        update_status(doc_id, 'ocr_processing')

        try:
            textract_response = textract.analyze_document(
                Document={'S3Object': {'Bucket': bucket, 'Name': key}},
                FeatureTypes=['TABLES', 'FORMS']
            )
            extracted_text = extract_text(textract_response)

            ocr_key = f"ocr-results/{doc_id}/result.json"
            s3.put_object(
                Bucket=bucket,
                Key=ocr_key,
                Body=json.dumps({
                    'text': extracted_text,
                    'raw_blocks': textract_response['Blocks']
                }, ensure_ascii=False),
                ContentType='application/json'
            )

            table.update_item(
                Key={'doc_id': doc_id},
                UpdateExpression='SET #s = :s, ocr_result_key = :k, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'ocr_done',
                    ':k': ocr_key,
                    ':u': datetime.utcnow().isoformat()
                }
            )
            print(f"OCR 완료: doc_id={doc_id}")

        except Exception as e:
            print(f"OCR 실패: {str(e)}")
            update_status(doc_id, 'error', str(e))

def extract_text(textract_response):
    return '\n'.join(
        block['Text']
        for block in textract_response['Blocks']
        if block['BlockType'] == 'LINE'
    )

def update_status(doc_id, status, error_message=None):
    update_expr = 'SET #s = :s, updated_at = :u'
    values = {':s': status, ':u': datetime.utcnow().isoformat()}
    if error_message:
        update_expr += ', error_message = :e'
        values[':e'] = error_message

    table.update_item(
        Key={'doc_id': doc_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues=values
    )
```

### 7.2 ai-analyzer (콘솔 인라인 배포 — Bedrock 호출) ⭐

Lambda 콘솔 → `sgu-pj-01-ai-analyzer` → **코드** 탭에 아래 코드 붙여넣고 **Deploy**:

```python
import json
import os
import re
from datetime import datetime

import boto3

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime', region_name=os.environ.get('BEDROCK_REGION', 'us-east-1'))

DOCUMENTS_TABLE = os.environ.get('DOCUMENTS_TABLE', 'sgu-pj-01-documents')
S3_BUCKET = os.environ.get('S3_BUCKET', 'sgu-pj-01-littleboss-docs')
MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')

PROMPT_TEMPLATE = """당신은 한국 행정 서류 분석 전문가입니다.
아래 문서 내용을 분석하여 반드시 JSON 형식으로만 반환하세요.
다른 설명 없이 JSON만 출력하세요.

출력 형식:
{{
  "document_type": "서류 종류 (예: 장학금 공지, 인턴십 모집, 공모전 등)",
  "summary": "문서 핵심 내용 2~3줄 요약",
  "deadlines": [
    {{"date": "YYYY-MM-DD", "description": "마감 내용", "urgency": "high/normal/low"}}
  ],
  "required_documents": [
    {{"name": "서류명", "description": "설명", "have": false}}
  ],
  "calendar_events": [
    {{"title": "일정 제목", "date": "YYYY-MM-DD", "time": "HH:MM", "description": "설명"}}
  ]
}}

분석할 문서:
{text}
"""


def lambda_handler(event, context):
    table = dynamodb.Table(DOCUMENTS_TABLE)

    for record in event['Records']:
        if record['eventName'] not in ['INSERT', 'MODIFY']:
            continue

        new_image = record['dynamodb'].get('NewImage', {})
        status = new_image.get('status', {}).get('S', '')

        if status != 'ocr_done':
            continue

        doc_id = new_image.get('doc_id', {}).get('S', '')
        user_id = new_image.get('user_id', {}).get('S', '')
        raw_text = new_image.get('raw_text', {}).get('S', '')

        print(f"AI 분석 시작: doc_id={doc_id}")
        _update_status(table, doc_id, user_id, 'ai_processing')

        try:
            analysis = _analyze_with_bedrock(raw_text)

            checklist = [
                {'name': d['name'], 'description': d.get('description', ''), 'completed': False}
                for d in analysis.get('required_documents', [])
            ]

            table.update_item(
                Key={'doc_id': doc_id, 'user_id': user_id},
                UpdateExpression='SET #s = :s, analysis = :a, checklist = :c, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'done',
                    ':a': analysis,
                    ':c': checklist,
                    ':u': datetime.utcnow().isoformat(),
                }
            )

            s3.put_object(
                Bucket=S3_BUCKET,
                Key=f"analysis-results/{doc_id}/result.json",
                Body=json.dumps(analysis, ensure_ascii=False),
                ContentType='application/json'
            )

            print(f"AI 분석 완료: doc_id={doc_id}, type={analysis.get('document_type', 'unknown')}")

        except Exception as e:
            print(f"AI 분석 실패: doc_id={doc_id}, error={str(e)}")
            _update_status(table, doc_id, user_id, 'error', str(e))


def _analyze_with_bedrock(text):
    """Bedrock Claude 3 Sonnet으로 서류 분석"""
    prompt = PROMPT_TEMPLATE.format(text=text)

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps(request_body),
        contentType='application/json',
        accept='application/json'
    )

    response_body = json.loads(response['body'].read())
    response_text = response_body['content'][0]['text']
    return _parse_response(response_text)


def _parse_response(raw):
    """Claude 응답에서 JSON 추출"""
    raw = re.sub(r"```json\s*|\s*```", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            'document_type': '알 수 없음',
            'summary': '분석 실패 - 다시 시도해주세요',
            'deadlines': [],
            'required_documents': [],
            'calendar_events': [],
        }


def _update_status(table, doc_id, user_id, status, error_message=None):
    update_expr = 'SET #s = :s, updated_at = :u'
    expr_values = {
        ':s': status,
        ':u': datetime.utcnow().isoformat(),
    }
    expr_names = {'#s': 'status'}

    if error_message:
        update_expr += ', error_message = :e'
        expr_values[':e'] = f'AI 분석 실패: {error_message}'

    table.update_item(
        Key={'doc_id': doc_id, 'user_id': user_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
```

> ⭐ Bedrock은 boto3에 내장되어 있어 **별도 zip 패키징 불필요**.
> 단, Lambda 역할에 `bedrock:InvokeModel` 권한이 있어야 함 (`aws_setup_guide.md` 3-4 절 참고).

### 7.3 action-executor (ZIP 업로드 배포)

action-executor의 상세 코드는 Google Calendar 연동 Phase에서 작성됩니다. 현재 단계에서는 플레이스홀더 코드로 먼저 배포:

```bash
cd ~/lambda-build/action-executor
nano lambda_function.py
```

임시 플레이스홀더:
```python
import json

def lambda_handler(event, context):
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({'message': 'action-executor placeholder'})
    }
```

같은 방식으로 ZIP 만들고 업로드:
```bash
cd ~/lambda-build/action-executor
zip -r ../action-executor.zip . -q

aws lambda update-function-code \
  --function-name sgu-pj-01-action-executor \
  --zip-file fileb://../action-executor.zip \
  --region ap-northeast-2 \
  --no-cli-pager
```

---

## 8. Step 5: 트리거 연결

### 8.1 S3 → OCR Handler 트리거

```
1. S3 > sgu-pj-01-littleboss-docs > 속성 탭
2. 이벤트 알림 > "이벤트 알림 생성" 클릭
3. 설정
   → 이벤트 이름: trigger-ocr-on-upload
   → 접두사: uploads/
   → 이벤트 유형: ✅ 모든 객체 생성 이벤트
   → 대상: Lambda 함수 > sgu-pj-01-ocr-handler
4. "변경 사항 저장"
```

### 8.2 DynamoDB Streams → AI Analyzer 트리거

```
1. DynamoDB > sgu-pj-01-documents > "내보내기 및 스트림" 탭
2. DynamoDB 스트림 세부 정보 > "활성화"
   → 보기 유형: "새 이미지" (NEW_IMAGE)
3. 같은 페이지 트리거 섹션 > "트리거 생성"
   → Lambda 함수: sgu-pj-01-ai-analyzer
   → 배치 크기: 1
   → 시작 위치: 최신 (LATEST)
4. "생성"
```

### 8.3 API Gateway → Upload Handler, Action Executor

```
1. API Gateway > "API 생성" > REST API > "구축"
2. API 이름: sgu-pj-01-littleboss-api
3. 리소스 및 메서드 생성:
   /upload (POST) → sgu-pj-01-upload-handler
   /documents (GET) → sgu-pj-01-upload-handler
   /documents/{doc_id} (GET) → sgu-pj-01-upload-handler
   /calendar/{doc_id} (POST) → sgu-pj-01-action-executor
   /checklist/{doc_id} (GET, PATCH) → sgu-pj-01-action-executor

   → 각 메서드마다 "Lambda 프록시 통합" ✅ 체크
   → 각 리소스에서 "CORS 활성화"

4. "API 배포" > 새 스테이지 "prod"
```

---

## 9. Step 6: 테스트

### 9.1 Lambda 콘솔에서 단일 함수 테스트

```
Lambda > sgu-pj-01-upload-handler > 테스트 탭

테스트 이벤트:
{
    "httpMethod": "GET",
    "path": "/health",
    "queryStringParameters": null,
    "pathParameters": null,
    "body": null
}

→ "테스트" 클릭 → 응답 확인
```

### 9.2 전체 파이프라인 테스트

```
1. S3에 테스트 파일 업로드
   S3 > sgu-pj-01-littleboss-docs > uploads/test-001/ > 파일 업로드

2. CloudWatch 로그 확인
   /aws/lambda/sgu-pj-01-ocr-handler → OCR 로그
   /aws/lambda/sgu-pj-01-ai-analyzer → AI 분석 로그

3. DynamoDB 확인
   sgu-pj-01-documents → status가 uploaded → ocr_done → done으로 진행
```

### 9.3 CloudShell 테스트 명령어

```bash
# 로그 실시간 보기
aws logs tail /aws/lambda/sgu-pj-01-ocr-handler --follow

# Lambda 직접 호출
aws lambda invoke --function-name sgu-pj-01-upload-handler \
    --payload '{"httpMethod":"GET","path":"/health"}' \
    --region ap-northeast-2 \
    response.json

cat response.json
```

---

## 10. 트러블슈팅

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| `lambda:PublishLayerVersion explicit deny` | 학교 계정에서 Layer 생성 차단 | Layer 대신 zip에 패키지 직접 포함 (이 가이드 방식) |
| `Task timed out after X seconds` | 타임아웃 너무 짧음 | 구성 > 일반 구성 > 타임아웃 늘리기 |
| `No module named 'googleapiclient'` (action-executor) | ZIP에 패키지 누락 | `pip install -t .` 후 폴더 전체 zip 확인 |
| `bedrock:InvokeModel AccessDenied` | Lambda 역할에 Bedrock 권한 없음 | `aws_setup_guide.md` 3-4 절 — IAM 인라인 정책 추가 |
| `Could not find model anthropic.claude-3-sonnet...` | 모델 액세스 미활성화 또는 잘못된 리전 | us-east-1에서 모델 액세스 활성화 + `BEDROCK_REGION=us-east-1` 환경변수 확인 |
| Bedrock 호출 시 `ValidationException` | request body 형식 오류 | Claude messages API 형식 확인 (`anthropic_version`, `messages` 필수) |
| ZIP 업로드 후에도 import 실패 | ZIP 구조 오류 | ZIP 루트에 `lambda_function.py`와 패키지 폴더가 같이 있어야 함 |
| `AccessDeniedException` | `Nxt-Lambda-Basic-Role` 권한 부족 | CloudWatch Logs로 거부된 액션 확인 후 관리자 요청 |
| 함수 생성 시 `explicit deny` | 이름에 `sgu-pj-01-` 접두사 누락 | 함수 이름 확인 |
| S3 트리거 안 됨 | 이벤트 알림 미설정 또는 접두사 오타 | S3 > 속성 > 이벤트 알림 재확인 |
| DynamoDB Streams 트리거 안 됨 | Streams 미활성화 | DynamoDB > 스트림 활성화 확인 |
| `Unable to import module` | 핸들러 경로 오류 | 기본값 `lambda_function.lambda_handler` 확인 |
| CORS 에러 | API Gateway / Lambda 응답 헤더 누락 | Lambda 응답에 `Access-Control-Allow-Origin` 포함 |
| Textract AccessDenied | 역할에 textract 권한 없음 | 관리자에게 `textract:*` 권한 추가 요청 |
| SNS Publish 실패 | 역할에 `sns:Publish` 권한 없음 | 관리자 요청 |
| Scheduler 생성 실패 | 역할에 `scheduler:CreateSchedule` 권한 없음 | 관리자 요청 |

### ZIP 구조 정상 확인

```bash
# ZIP 내용 조회
unzip -l ~/lambda-build/ai-analyzer.zip | head -20
```

올바른 구조:
```
lambda_function.py           ← 루트에 있어야 함
google/
google_auth/
requests/
...
```

**틀린 구조** (이렇게 되면 import 실패):
```
ai-analyzer/lambda_function.py   ← 폴더 안에 들어가 있으면 X
ai-analyzer/google/
```

→ ZIP 만들 때 `cd ai-analyzer && zip -r ../x.zip .` 처럼 폴더 **안에서** zip 해야 합니다.

### 로그 확인 방법

```
CloudWatch > 로그 그룹 > /aws/lambda/sgu-pj-01-{함수이름}
→ 최신 로그 스트림 클릭
→ print() 출력 및 에러 내용 확인
```

### 유용한 AWS CLI 명령어

```bash
# 내 Lambda 함수 목록
aws lambda list-functions --region ap-northeast-2 \
  --query "Functions[?starts_with(FunctionName, 'sgu-pj-01-')].FunctionName"

# 함수 설정 확인
aws lambda get-function-configuration \
  --function-name sgu-pj-01-ai-analyzer \
  --region ap-northeast-2

# 환경변수 업데이트
aws lambda update-function-configuration \
  --function-name sgu-pj-01-ai-analyzer \
  --environment "Variables={GEMINI_API_KEY=xxx,S3_BUCKET=sgu-pj-01-littleboss-docs,DOCUMENTS_TABLE=sgu-pj-01-documents}" \
  --region ap-northeast-2
```
