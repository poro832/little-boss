# LittleBoss — DynamoDB 스키마 설계

> 리전 `ap-northeast-2` · 계정 `443370697536`
> 테이블 **2개**(`documents`, `users`). 신규 테이블을 늘리지 않고, **`users` 테이블 하나에 키 프리픽스로 여러 종류의 레코드**(유저·Slack매핑·멱등마커)를 담는 **단일 테이블 설계**를 사용한다.
> *(권한 경계상 새 리소스 생성이 제한적이라, 기존 테이블을 재사용하는 방향으로 설계함.)*

---

## 1. `sgu-pj-03-documents` — 문서

업로드된 문서의 메타데이터, AI 분석 결과, 체크리스트를 저장한다.

| 항목 | 설계 |
|---|---|
| **Partition Key** | `doc_id` (S, uuid4) |
| **GSI** | `user_id-index` — Partition Key `user_id` (S) · Projection `ALL` |
| **GSI 용도** | `list_documents(user_id)` — 웹 대시보드·일정 화면의 유저별 문서 조회 |

### 항목(Item) 속성

| 속성 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `doc_id` | S | ✅ | PK, uuid4 |
| `user_id` | S | ✅ | 이메일가입=이메일 / 구글로그인=구글 sub / Slack연결=구글이메일 / 미연결 Slack=`slack:<id>` / 익명=`anonymous` |
| `filename` | S | ✅ | 원본 파일명 |
| `file_path` | S | ✅ | S3 key `uploads/{doc_id}/{filename}` |
| `status` | S | ✅ | `uploaded` → `ocr_processing` → `ocr_done` → `ai_processing` → `done` (실패 시 `error`) |
| `raw_text` | S | | OCR 추출 텍스트 또는 마커(`__UNSUPPORTED__`, `__IMAGE_FILE__`) |
| `analysis` | M | | AI 분석 결과 (아래 표) |
| `checklist` | L\<M> | | 필요서류 체크 상태(요청 시 생성): `{name, description, completed}` |
| `created_at` | S | | ISO8601 |
| `updated_at` | S | | 체크리스트 수정 시 |
| `error_message` | S | | `status=error` 시 |
| `source` | S | | Slack 출처면 `"slack"` (웹 업로드는 없음) |
| `slack_channel` | S | | *(source=slack 전용)* 채널 id |
| `slack_thread_ts` | S | | *(source=slack 전용)* 스레드 anchor ts |
| `slack_user` | S | | *(source=slack 전용)* Slack user id |

### `analysis` (Map) 내부 구조

| 필드 | 타입 | 요소 구조 |
|---|---|---|
| `document_type` | S | 문서 종류 |
| `summary` | S | 요약 |
| `deadlines` | L\<M> | `{ date: "YYYY-MM-DD", description, urgency: "high|normal|low" }` |
| `required_documents` | L\<M> | `{ name, description, have: BOOL }` |
| `calendar_events` | L\<M> | `{ title, date: "YYYY-MM-DD", time: "HH:MM"(기본 23:59), description, location }` |

---

## 2. `sgu-pj-03-users` — 유저 / 매핑 / 멱등마커 (단일 테이블)

Partition Key `user_id` **하나**로, **키 프리픽스**에 따라 4종류의 레코드를 구분한다. **GSI 없음.**

| 키 패턴 | 레코드 종류 |
|---|---|
| `<email>` | 이메일/비밀번호 가입 유저 |
| `<google_sub>` | 구글 로그인 유저(프로필·알림설정 시 지연 생성) |
| `slack#<slack_user_id>` | Slack 유저 → 이메일 매핑 |
| `evt#<event_id>` | Slack 이벤트 멱등 마커(재시도 중복 방지) |

### 2-1. 이메일 가입 유저 — 키 `<email>`

| 속성 | 타입 | 설명 |
|---|---|---|
| `user_id` | S | = 이메일 |
| `email` | S | |
| `name` | S | |
| `password_hash` | S | `HMAC-SHA256(KMS pepper, PBKDF2(pw, salt))` (v2) |
| `salt` | S | `secrets.token_hex(16)` |
| `hash_version` | N | `2`=페퍼 적용 / 없음·`1`=레거시(로그인 시 자동 마이그레이션) |
| `auth_type` | S | `"email"` |
| `created_at` | S | |
| `affiliation` | S | *(선택)* 소속 |
| `notif_settings` | M | *(선택)* `{deadline, incomplete, analysis, mail, weekly}` 각 BOOL |
| `notify_email_subscribed` | BOOL | *(선택)* SNS 완료알림 구독 여부 |
| `google_refresh_token` | S | *(선택)* Slack→Google 캘린더 연동 시 저장 |
| `reset_code` | S | *(선택)* 비번찾기 코드 해시 |
| `reset_expires` | N | *(선택)* epoch, 코드 만료 |

### 2-2. 구글 로그인 유저 — 키 `<google_sub>`

| 속성 | 타입 | 설명 |
|---|---|---|
| `user_id` | S | = 구글 sub(숫자) |
| `auth_type` | S | `"google"` |
| `created_at` | S | |
| `name` / `affiliation` / `notif_settings` | S / S / M | *(선택)* |

### 2-3. Slack↔이메일 매핑 — 키 `slack#<slack_user_id>`

| 속성 | 타입 | 설명 |
|---|---|---|
| `user_id` | S | = `"slack#"` + Slack user id |
| `email` | S | 연결된 구글 이메일 |
| `auth_type` | S | `"slack_link"` |

### 2-4. 멱등 마커 — 키 `evt#<event_id>`

| 속성 | 타입 | 설명 |
|---|---|---|
| `user_id` | S | = `"evt#"` + Slack event id |
| `ttl` | N | epoch+86400 (DynamoDB TTL 자동삭제 의도 — TTL 활성화는 테이블 설정) |

---

## 설계 노트

- **단일 테이블 + 키 프리픽스**: `users` 한 테이블에 유저·Slack매핑·멱등마커를 담아 테이블 수를 최소화(권한 경계상 새 리소스 최소화).
- **GSI는 1개만**: 문서를 유저별로 조회하는 `documents.user_id-index`. `users`는 PK 직접 조회만 사용.
- **로컬 동등성**: `ENV=local`이면 DynamoDB 대신 `backend/local_db/*.json` 파일로 같은 스키마를 시뮬레이션.
- **테이블명 주입**: env `DOCUMENTS_TABLE` / `USERS_TABLE` (기본값이 위 이름).
- **용량/과금 모드**: 코드 영역 밖(콘솔/IaC) — 본 문서는 키·항목 스키마에 집중.

---

## 부록 — 기계 판독용 JSON

```json
{
  "region": "ap-northeast-2",
  "account": "443370697536",
  "tables": [
    {
      "name": "sgu-pj-03-documents",
      "partitionKey": { "name": "doc_id", "type": "S" },
      "gsi": [
        { "name": "user_id-index", "partitionKey": { "name": "user_id", "type": "S" }, "projection": "ALL" }
      ],
      "attributes": {
        "doc_id": "S", "user_id": "S", "filename": "S", "file_path": "S",
        "status": "S", "raw_text": "S",
        "analysis": {
          "document_type": "S", "summary": "S",
          "deadlines": [{ "date": "S", "description": "S", "urgency": "S" }],
          "required_documents": [{ "name": "S", "description": "S", "have": "BOOL" }],
          "calendar_events": [{ "title": "S", "date": "S", "time": "S", "description": "S", "location": "S" }]
        },
        "checklist": [{ "name": "S", "description": "S", "completed": "BOOL" }],
        "created_at": "S", "updated_at": "S", "error_message": "S",
        "source": "S", "slack_channel": "S", "slack_thread_ts": "S", "slack_user": "S"
      }
    },
    {
      "name": "sgu-pj-03-users",
      "partitionKey": { "name": "user_id", "type": "S" },
      "gsi": [],
      "keyPatterns": {
        "<email>": {
          "user_id": "S", "email": "S", "name": "S", "password_hash": "S", "salt": "S",
          "hash_version": "N", "auth_type": "email", "created_at": "S",
          "affiliation": "S?", "notif_settings": "M?", "notify_email_subscribed": "BOOL?",
          "google_refresh_token": "S?", "reset_code": "S?", "reset_expires": "N?"
        },
        "<google_sub>": {
          "user_id": "S", "auth_type": "google", "created_at": "S",
          "name": "S?", "affiliation": "S?", "notif_settings": "M?"
        },
        "slack#<slack_user_id>": { "user_id": "S", "email": "S", "auth_type": "slack_link" },
        "evt#<event_id>": { "user_id": "S", "ttl": "N" }
      }
    }
  ]
}
```
