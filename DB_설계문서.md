# LittleBoss - DynamoDB 데이터베이스 설계 문서

## 1. 개요

LittleBoss는 AWS DynamoDB를 데이터베이스로 사용합니다.
DynamoDB는 AWS의 완전관리형 NoSQL 데이터베이스로, 별도의 스키마(테이블 구조)를 미리 정의할 필요 없이 유연하게 데이터를 저장할 수 있습니다.

> **왜 DynamoDB인가?**
> - Lambda와의 네이티브 연동 (DynamoDB Streams → Lambda 자동 트리거)
> - 서버리스 아키텍처에 최적화 (사용량 기반 과금, 자동 확장)
> - AWS 생태계 내 통합이 간편 (IAM 권한, S3 이벤트 등)

---

## 2. 테이블 목록

| 테이블명 | 용도 | Partition Key | Sort Key |
|---------|------|--------------|----------|
| `littleboss-documents-table` | 업로드 문서 및 분석 결과 관리 (메인 테이블) | `doc_id` (String) | `user_id` (String) |
| `littleboss-checklists` | 체크리스트 관리 (예약) | - | - |
| `littleboss-users` | 사용자 정보 관리 (예약) | - | - |

> `littleboss-checklists`와 `littleboss-users`는 환경변수에 정의되어 있으나, 현재는 메인 documents 테이블에 통합하여 운영 중입니다.

---

## 3. 메인 테이블: `littleboss-documents-table`

### 3.1 키 설계

| 키 종류 | 속성명 | 타입 | 설명 |
|--------|-------|------|------|
| **Partition Key (PK)** | `doc_id` | String (UUID) | 문서 고유 식별자 |
| **Sort Key (SK)** | `user_id` | String | 사용자 ID |

### 3.2 GSI (Global Secondary Index)

| 인덱스명 | Partition Key | Sort Key | 용도 |
|---------|--------------|----------|------|
| `user_id-index` | `user_id` | - | 특정 사용자의 문서 목록 조회 |

### 3.3 속성 (Attributes)

| 속성명 | 타입 | 필수 | 설명 | 예시 |
|-------|------|------|------|------|
| `doc_id` | String | O | 문서 UUID (PK) | `"33e0a9a6-2f60-4f47-adba-5929ecd05ae2"` |
| `user_id` | String | O | 사용자 ID (SK) | `"local_user"`, `"anonymous"` |
| `filename` | String | O | 원본 파일명 | `"장학금공지.pdf"` |
| `file_path` | String | O | S3 저장 경로 | `"uploads/{doc_id}/{filename}"` |
| `status` | String | O | 처리 상태 | 아래 상태 흐름 참조 |
| `raw_text` | String | - | OCR 추출 텍스트 | `"2026학년도 장학금 신청..."` |
| `analysis` | Map | - | AI 분석 결과 (JSON) | 아래 상세 구조 참조 |
| `checklist` | List | - | 필요 서류 체크리스트 | 아래 상세 구조 참조 |
| `error_message` | String | - | 에러 발생 시 메시지 | `"OCR 실패: ..."` |
| `created_at` | String | O | 생성 시각 (ISO 8601) | `"2026-03-10T14:59:29.057725"` |
| `updated_at` | String | - | 수정 시각 (ISO 8601) | `"2026-03-10T15:01:12.000000"` |

---

## 4. 문서 상태 흐름 (Status Flow)

문서가 업로드되면 아래 순서로 상태가 변경되며, 각 상태 변경이 다음 Lambda를 자동으로 트리거합니다.

```
UPLOADED → ocr_done → ai_processing → done
                                        ↘ error (실패 시)
```

| 상태 | 의미 | 트리거한 Lambda | 다음 단계 |
|------|------|----------------|----------|
| `UPLOADED` | Presigned URL 발급, 파일 업로드 대기 | upload-handler | S3 업로드 완료 시 → OCR |
| `ocr_done` | OCR 텍스트 추출 완료 | ocr-handler | DynamoDB Streams → AI 분석 |
| `ai_processing` | Gemini AI 분석 중 | ai-analyzer | - |
| `done` | 전체 파이프라인 완료 | ai-analyzer | 프론트엔드에서 결과 표시 |
| `error` | 처리 중 오류 발생 | ocr-handler / ai-analyzer | 프론트엔드에서 에러 표시 |

---

## 5. 중첩 데이터 구조

### 5.1 `analysis` (Map) - AI 분석 결과

Gemini AI가 문서를 분석한 결과가 저장됩니다.

```json
{
  "document_type": "장학금 공지",
  "summary": "2026학년도 1학기 교내 장학금 신청 안내. 신청 기간은 3월 15일까지...",
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
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `document_type` | String | 문서 종류 (장학금 공지, 인턴십 모집, 공모전 등) |
| `summary` | String | 문서 핵심 내용 2~3줄 요약 |
| `deadlines` | List\<Map\> | 마감일 목록 |
| `deadlines[].date` | String | 마감 날짜 (YYYY-MM-DD) |
| `deadlines[].description` | String | 마감 내용 |
| `deadlines[].urgency` | String | 긴급도 (`high` / `normal` / `low`) |
| `required_documents` | List\<Map\> | 필요 서류 목록 |
| `required_documents[].name` | String | 서류명 |
| `required_documents[].description` | String | 서류 설명 |
| `required_documents[].have` | Boolean | 보유 여부 |
| `calendar_events` | List\<Map\> | 캘린더 등록용 일정 |
| `calendar_events[].title` | String | 일정 제목 |
| `calendar_events[].date` | String | 일정 날짜 (YYYY-MM-DD) |
| `calendar_events[].time` | String | 일정 시간 (HH:MM) |
| `calendar_events[].description` | String | 일정 설명 |

### 5.2 `checklist` (List) - 필요 서류 체크리스트

`analysis.required_documents`를 기반으로 생성되며, 사용자가 서류 준비 상태를 체크할 수 있습니다.

```json
[
  {
    "name": "성적증명서",
    "description": "직전 학기 성적증명서 1부",
    "completed": false
  },
  {
    "name": "재학증명서",
    "description": "재학증명서 1부",
    "completed": true
  }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | String | 서류명 |
| `description` | String | 서류 설명 |
| `completed` | Boolean | 준비 완료 여부 |

---

## 6. DynamoDB Streams 연동

DynamoDB Streams는 테이블 데이터 변경을 실시간으로 감지하여 Lambda를 자동 트리거하는 기능입니다.

```
[ocr-handler]                        [ai-analyzer]
     |                                     |
     | status를 "ocr_done"으로 변경         |
     |                                     |
     └──→ DynamoDB Streams 이벤트 발생 ──→ |
                                           | status == "ocr_done" 확인
                                           | Gemini AI 분석 실행
                                           | status를 "done"으로 변경
```

- **스트림 타입**: NEW_AND_OLD_IMAGES (변경 전후 데이터 모두 전달)
- **필터 조건**: ai-analyzer는 `status == "ocr_done"`인 경우에만 처리 (무한 루프 방지)

---

## 7. 데이터 접근 패턴

| 작업 | Lambda | DynamoDB 연산 | 키 / 인덱스 |
|------|--------|--------------|------------|
| 문서 생성 | upload-handler | `put_item` | PK: `doc_id`, SK: `user_id` |
| 문서 단건 조회 | upload-handler | `get_item` | PK: `doc_id` |
| 사용자별 문서 목록 | upload-handler | `query` (GSI) | `user_id-index` |
| OCR 결과 저장 | ocr-handler | `update_item` | PK: `doc_id`, SK: `user_id` |
| AI 분석 결과 저장 | ai-analyzer | `update_item` | PK: `doc_id`, SK: `user_id` |
| 체크리스트 조회/수정 | action-executor | `query` → `update_item` | PK: `doc_id` |
| 상태 업데이트 | 모든 Lambda | `update_item` | PK: `doc_id`, SK: `user_id` |

---

## 8. 실제 저장 데이터 예시

### 업로드 직후 (status: UPLOADED)

```json
{
  "doc_id": "33e0a9a6-2f60-4f47-adba-5929ecd05ae2",
  "user_id": "local_user",
  "filename": "장학금공지.pdf",
  "file_path": "uploads/33e0a9a6-2f60-4f47-adba-5929ecd05ae2/장학금공지.pdf",
  "status": "UPLOADED",
  "created_at": "2026-03-10T14:59:29.057725"
}
```

### 전체 파이프라인 완료 후 (status: done)

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
    "summary": "2026학년도 1학기 교내 장학금 신청 안내...",
    "deadlines": [
      { "date": "2026-03-15", "description": "장학금 신청 마감", "urgency": "high" }
    ],
    "required_documents": [
      { "name": "성적증명서", "description": "직전 학기 성적증명서 1부", "have": false }
    ],
    "calendar_events": [
      { "title": "장학금 신청 마감", "date": "2026-03-15", "time": "23:59", "description": "마감일" }
    ]
  },
  "checklist": [
    { "name": "성적증명서", "description": "직전 학기 성적증명서 1부", "completed": false }
  ],
  "created_at": "2026-03-10T14:59:29.057725",
  "updated_at": "2026-03-10T15:01:12.000000"
}
```

---

## 9. S3 연동 저장 구조

DynamoDB 외에 S3에도 데이터가 백업/저장됩니다.

| S3 경로 | 내용 | 저장 시점 |
|---------|------|----------|
| `uploads/{doc_id}/{filename}` | 원본 업로드 파일 | 프론트엔드 → Presigned URL 업로드 |
| `ocr-results/{doc_id}/result.json` | OCR 추출 텍스트 | ocr-handler 처리 완료 시 |
| `analysis-results/{doc_id}/result.json` | AI 분석 결과 JSON | ai-analyzer 처리 완료 시 |
