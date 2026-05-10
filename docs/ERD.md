# LittleBoss ERD (Entity Relationship Diagram)

> 아래 Mermaid 코드를 https://mermaid.live 에 붙여넣으면 이미지로 다운로드 가능

```mermaid
erDiagram
    USERS {
        string user_id PK "Google OAuth sub"
        string email "구글 계정 이메일"
        string google_calendar_token "암호화된 OAuth Refresh Token"
        string created_at "ISO 8601"
    }

    DOCUMENTS {
        string doc_id PK "UUID v4"
        string user_id FK "USERS.user_id (GSI)"
        string filename "원본 파일명"
        string s3_key "S3 저장 경로"
        string status "uploaded-ocr_done-analyzing-done-error"
        string ocr_result_key "OCR 결과 S3 키"
        map analysis_result "AI 분석 결과 JSON"
        string error_message "에러 메시지"
        string created_at "ISO 8601"
        string updated_at "ISO 8601"
    }

    CHECKLISTS {
        string checklist_id PK "UUID v4"
        string doc_id FK "DOCUMENTS.doc_id (GSI)"
        string name "준비물 이름"
        string description "준비물 설명"
        boolean completed "준비 완료 여부"
        string created_at "ISO 8601"
    }

    ANALYSIS_RESULT {
        string document_type "서류 종류"
        string summary "핵심 요약 2-3줄"
    }

    DEADLINES {
        string date "YYYY-MM-DD"
        string description "마감 내용"
        string urgency "high-medium-low"
    }

    CALENDAR_EVENTS {
        string title "일정 제목"
        string date "YYYY-MM-DD"
        string time "HH:MM"
        string location "장소"
        string description "설명"
    }

    ACTION_ITEMS {
        string action "해야 할 일"
        string due_date "YYYY-MM-DD"
        string priority "high-medium-low"
    }

    USERS ||--o{ DOCUMENTS : "업로드"
    DOCUMENTS ||--o{ CHECKLISTS : "준비물 체크리스트"
    DOCUMENTS ||--|| ANALYSIS_RESULT : "AI 분석 결과 (JSON 내장)"
    ANALYSIS_RESULT ||--o{ DEADLINES : "마감일 목록"
    ANALYSIS_RESULT ||--o{ CALENDAR_EVENTS : "캘린더 이벤트"
    ANALYSIS_RESULT ||--o{ ACTION_ITEMS : "할 일 목록"
```

---

## DynamoDB 테이블 매핑

| 논리 엔티티 | DynamoDB 테이블 | PK | GSI |
|------------|----------------|-----|-----|
| USERS | `sgu-pj-01-users` | `user_id` | `email-index` |
| DOCUMENTS | `sgu-pj-01-documents` | `doc_id` | `user_id-index` |
| CHECKLISTS | `sgu-pj-01-checklists` | `checklist_id` | `doc_id-index` |
| ANALYSIS_RESULT | `sgu-pj-01-documents`의 `analysis_result` 필드 (비정규화) | - | - |
| DEADLINES | `analysis_result.deadlines` 배열 | - | - |
| CALENDAR_EVENTS | `analysis_result.calendar_events` 배열 | - | - |
| ACTION_ITEMS | `analysis_result.action_items` 배열 | - | - |

---

## 문서 상태 흐름도

```mermaid
stateDiagram-v2
    [*] --> uploaded : 서류 업로드
    uploaded --> ocr_done : Textract OCR 완료
    uploaded --> error : OCR 실패
    ocr_done --> analyzing : Gemini AI 분석 시작
    analyzing --> done : 분석 완료
    analyzing --> error : 분석 실패
    done --> [*]
    error --> [*]
```
