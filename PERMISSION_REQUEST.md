# AWS 권한 추가 요청서 (통합)

**계정**: `sgu-pj-03` (443370697536)
**대상 역할**: `SafeRole-sgu-pj`
**프로젝트**: LittleBoss (서류 분석 자동화)

LittleBoss 백엔드 파이프라인 동작을 위해 `SafeRole-sgu-pj`에 아래 2종류 권한 추가를 요청드립니다.

---

## 요청 1: Textract 비동기 OCR 권한

### 발생 오류
```
AccessDeniedException when calling the StartDocumentTextDetection operation:
User: arn:aws:sts::443370697536:assumed-role/SafeRole-sgu-pj/sgu-pj-03-ocr-handler
is not authorized to perform: textract:StartDocumentTextDetection
because no identity-based policy allows the textract:StartDocumentTextDetection action
```

### 원인
현재 `textract:AnalyzeDocument`(단일 페이지 동기)는 부여되어 있으나, **다중 페이지 PDF**는 Textract 비동기 API를 써야만 처리 가능합니다. Textract는 다중 페이지 PDF의 동기 처리를 지원하지 않습니다.

### 필요 액션 (읽기 전용)
- `textract:StartDocumentTextDetection` — 다중 페이지 OCR 작업 시작
- `textract:GetDocumentTextDetection` — OCR 결과 조회

### 추가 정책 (JSON)
```json
{
  "Effect": "Allow",
  "Action": [
    "textract:StartDocumentTextDetection",
    "textract:GetDocumentTextDetection"
  ],
  "Resource": "*"
}
```
> Textract는 리소스 레벨 ARN을 지원하지 않아 `Resource: "*"`가 표준입니다 (AWS 공식 문서 기준).

---

## 요청 2: DynamoDB Streams 권한

### 발생 오류
```
InvalidParameterValueException when calling the CreateEventSourceMapping operation:
Cannot access stream
arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-03-documents/stream/...
Please ensure the role can perform the GetRecords, GetShardIterator,
DescribeStream, and ListStreams Actions on your stream in IAM.
```

### 원인
`sgu-pj-03-ai-analyzer` Lambda를 DynamoDB Streams에 연결하려면 스트림 읽기 권한이 필요합니다. 정책에 액션이 있더라도 Resource가 테이블 ARN까지만 명시되어 스트림 ARN(`.../stream/타임스탬프`)과 매칭되지 않는 것으로 추정됩니다.

### 필요 액션 (읽기 전용)
- `dynamodb:GetRecords`
- `dynamodb:GetShardIterator`
- `dynamodb:DescribeStream`
- `dynamodb:ListStreams`

### 추가 정책 (JSON)
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetRecords",
    "dynamodb:GetShardIterator",
    "dynamodb:DescribeStream",
    "dynamodb:ListStreams"
  ],
  "Resource": "arn:aws:dynamodb:ap-northeast-2:443370697536:table/sgu-pj-03-*/stream/*"
}
```

---

## 보안 안전성

- 모든 액션이 **읽기 전용** — 데이터/리소스 수정·삭제 불가
- DynamoDB는 Resource를 `sgu-pj-03-*`로 제한 → 타 사용자 리소스 접근 불가
- Textract는 AWS 정책상 리소스 ARN 미지원이라 `*` 사용 (모든 Lambda × Textract 통합의 표준)
- 모두 AWS 공식 권장 패턴 (Lambda × Textract, Lambda × DynamoDB Streams)

---

## 두 권한이 필요한 이유 (파이프라인)

```
PDF 업로드 → S3
  ↓ (S3 트리거)
ocr-handler Lambda → Textract 비동기 OCR  ← 요청 1 필요
  ↓ DynamoDB 저장 (status=ocr_done)
DynamoDB Streams                          ← 요청 2 필요
  ↓ (스트림 트리거)
ai-analyzer Lambda → Bedrock AI 분석
  ↓ DynamoDB 저장 (status=done)
프론트엔드 폴링으로 결과 표시
```

요청 1이 없으면 OCR 단계에서, 요청 2가 없으면 AI 분석 단계에서 파이프라인이 중단됩니다.
