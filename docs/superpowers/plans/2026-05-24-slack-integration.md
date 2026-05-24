# Slack 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack 채널에 문서를 올리면 기존 분석 파이프라인이 자동 실행되고, 추출된 일정이 업로더의 개인 Google 캘린더에 등록되며, 결과가 업로드 스레드에 답글로 게시된다.

**Architecture:** Slack `file_shared` 이벤트 → API Gateway → `slack-handler`(서명검증·3초 ack·멱등) → SQS → `slack-worker`(파일 다운로드→기존 S3 업로드 경로 투입) → 기존 OCR/Bedrock 파이프라인 → `action-executor`가 refresh token으로 개인 캘린더 등록 + 스레드 답글. Slack↔Google 계정 연결은 offline OAuth로 refresh token을 KMS 암호화해 DynamoDB에 저장. 분석 엔진은 변경하지 않는다.

**Tech Stack:** Python 3.11 Lambda(stdlib + boto3, 외부 의존성 0), API Gateway(REST, `7al1rzghkf`), SQS, DynamoDB, KMS, Secrets Manager, Slack Web API, Google OAuth2. region `ap-northeast-2`, account `443370697536`, role `SafeRole-sgu-pj`.

**테스트 방식:** 이 repo는 pytest 미사용. 순수 로직(서명검증·state HMAC·멱등)은 `backend/tests/test_*.py`를 `python <file>` 로 실행하는 stdlib assert 스크립트로 작성. I/O 글루(파일 다운로드·S3·Slack 게시·OAuth)는 로컬 ENV=local 모킹 + 테스트 워크스페이스 E2E로 검증.

---

## 파일 구조

신규(backend/):
- `utils/slack.py` — Slack 서명 검증, 파일 다운로드, chat.postMessage, Block Kit 빌더
- `utils/slack_oauth.py` — state HMAC 서명/검증, Google code→token 교환, refresh→access 재발급
- `utils/slack_links.py` — slack-links DynamoDB CRUD(KMS 암복호), processed_events 멱등
- `handlers/slack_handler.py` — `POST /slack/events` 진입점(검증·challenge·ack·SQS enqueue)
- `handlers/slack_worker.py` — SQS 소비: 연결 확인→파일 다운로드→S3 업로드 경로 투입
- `handlers/google_oauth_handler.py` — `GET /slack/google/callback`
- `tests/test_slack_sig.py`, `tests/test_oauth_state.py`, `tests/test_dedup.py`

수정:
- `handlers/action_handler.py` — 파이프라인 종료 시 Slack 알림 + refresh token 기반 캘린더 등록
- (문서 레코드에 `source`/`slack_channel`/`slack_thread_ts` 필드는 dict에 추가 저장 — storage 변경 불필요)

---

## Phase 0 — 선행 설정 (사용자 수행, 게이트)

> ⚠️ 코드보다 먼저. 특히 IAM이 막히면(SES 전례) 이후 단계가 동작하지 않으므로 0-4를 가장 먼저 확인.

### Task 0-1: Slack 앱 생성
- [ ] api.slack.com/apps → Create New App → From scratch → 워크스페이스 선택
- [ ] OAuth & Permissions → Bot Token Scopes: `files:read`, `chat:write`, `im:write` 추가 → Install to Workspace → **Bot User OAuth Token**(`xoxb-...`) 확보
- [ ] Basic Information → **Signing Secret** 확보
- [ ] (Event Subscriptions·Request URL은 Phase 1에서 slack-handler 배포 후 등록)

### Task 0-2: Google OAuth offline 클라이언트
- [ ] Google Cloud Console → 기존 OAuth 클라이언트 → 승인된 리디렉션 URI에 `https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod/slack/google/callback` 추가
- [ ] OAuth 동의화면에 `.../auth/calendar.events` 스코프 포함 확인(기존 사용 중)
- [ ] client_id / client_secret 확보

### Task 0-3: AWS 리소스 생성 (CloudShell)
- [ ] SQS 큐 + DLQ:
```bash
aws sqs create-queue --queue-name sgu-pj-03-slack-dlq --region ap-northeast-2
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url $(aws sqs get-queue-url --queue-name sgu-pj-03-slack-dlq --region ap-northeast-2 --query QueueUrl --output text) --attribute-names QueueArn --region ap-northeast-2 --query 'Attributes.QueueArn' --output text)
aws sqs create-queue --queue-name sgu-pj-03-slack-jobs --region ap-northeast-2 --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"
```
- [ ] DynamoDB 테이블:
```bash
aws dynamodb create-table --table-name sgu-pj-03-slack-links --attribute-definitions AttributeName=slack_user_id,AttributeType=S --key-schema AttributeName=slack_user_id,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-northeast-2
aws dynamodb create-table --table-name sgu-pj-03-slack-events --attribute-definitions AttributeName=event_key,AttributeType=S --key-schema AttributeName=event_key,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-northeast-2
aws dynamodb update-time-to-live --table-name sgu-pj-03-slack-events --time-to-live-specification "Enabled=true,AttributeName=ttl" --region ap-northeast-2
```
- [ ] KMS 키:
```bash
aws kms create-key --description "LittleBoss Slack refresh token" --region ap-northeast-2 --query 'KeyMetadata.KeyId' --output text
aws kms create-alias --alias-name alias/sgu-pj-03-slack --target-key-id <KEY_ID> --region ap-northeast-2
```
- [ ] Secrets Manager:
```bash
aws secretsmanager create-secret --name sgu-pj-03/slack --region ap-northeast-2 --secret-string '{"signing_secret":"<...>","bot_token":"xoxb-...","google_client_id":"<...>","google_client_secret":"<...>"}'
```

### Task 0-4: IAM 권한 확인 (⚠️ 게이트)
- [ ] `SafeRole-sgu-pj`에 필요한 액션 부여 여부 확인/요청: `sqs:SendMessage`/`ReceiveMessage`/`DeleteMessage`, `dynamodb:*Item`(신규 2테이블), `kms:Encrypt`/`Decrypt`(키), `secretsmanager:GetSecretValue`, `lambda:InvokeFunction`(불필요-SQS 트리거 사용 시), `s3:PutObject`(기존 버킷)
```bash
aws iam put-role-policy --role-name SafeRole-sgu-pj --policy-name LittleBossSlack --policy-document file://slack-iam.json
```
- [ ] `AccessDenied`면 관리자/CTO 승인 필요 — **여기서 막히면 이후 단계 보류**

**Commit 없음(설정 단계). 코드 단계는 Phase 1부터.**

---

## Phase 1 — slack-handler (서명검증·ack·challenge·멱등)

### Task 1: Slack 서명 검증 (`utils/slack.py`)

**Files:**
- Create: `backend/utils/slack.py`
- Test: `backend/tests/test_slack_sig.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_slack_sig.py`
```python
import os, sys, time, hmac, hashlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.slack import verify_signature

SECRET = "testsecret"

def _sig(body, ts):
    base = f"v0:{ts}:{body}".encode()
    return "v0=" + hmac.new(SECRET.encode(), base, hashlib.sha256).hexdigest()

def test_valid():
    body = '{"a":1}'; ts = str(int(time.time()))
    assert verify_signature(SECRET, body, ts, _sig(body, ts)) is True

def test_tampered_body():
    ts = str(int(time.time()))
    assert verify_signature(SECRET, '{"a":2}', ts, _sig('{"a":1}', ts)) is False

def test_expired():
    body = '{"a":1}'; ts = str(int(time.time()) - 600)
    assert verify_signature(SECRET, body, ts, _sig(body, ts)) is False

if __name__ == "__main__":
    test_valid(); test_tampered_body(); test_expired(); print("OK")
```

- [ ] **Step 2: 실패 확인**
Run: `cd backend && PYTHONUTF8=1 python tests/test_slack_sig.py`
Expected: `ModuleNotFoundError`/`ImportError: cannot import name 'verify_signature'`

- [ ] **Step 3: 최소 구현** — `backend/utils/slack.py`
```python
"""Slack Web API + 서명 검증 (stdlib만 사용)."""
import hmac, hashlib, time, json, urllib.request, urllib.parse

def verify_signature(signing_secret: str, raw_body: str, timestamp: str, slack_sig: str, max_skew: int = 300) -> bool:
    """X-Slack-Signature 검증. timestamp 5분 윈도우 + HMAC-SHA256 상수시간 비교."""
    try:
        if abs(time.time() - int(timestamp)) > max_skew:
            return False
    except (TypeError, ValueError):
        return False
    base = f"v0:{timestamp}:{raw_body}".encode()
    expected = "v0=" + hmac.new(signing_secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, slack_sig or "")
```

- [ ] **Step 4: 통과 확인**
Run: `cd backend && PYTHONUTF8=1 python tests/test_slack_sig.py`
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add backend/utils/slack.py backend/tests/test_slack_sig.py
git commit -m "feat(slack): Slack 요청 서명 검증"
```

### Task 2: slack-handler 진입점 (challenge·ack·enqueue·멱등)

**Files:**
- Create: `backend/handlers/slack_handler.py`
- Create: `backend/utils/slack_links.py` (멱등 함수만 먼저)
- Test: `backend/tests/test_dedup.py`

- [ ] **Step 1: 멱등 로직 실패 테스트** — `backend/tests/test_dedup.py`
```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["ENV"] = "local"
from utils.slack_links import mark_event_seen

def test_first_true_then_false():
    key = "evt-123"
    assert mark_event_seen(key) is True    # 처음엔 신규
    assert mark_event_seen(key) is False   # 두 번째는 중복

if __name__ == "__main__":
    test_first_true_then_false(); print("OK")
```

- [ ] **Step 2: 실패 확인**
Run: `cd backend && ENV=local PYTHONUTF8=1 python tests/test_dedup.py`
Expected: `ImportError: cannot import name 'mark_event_seen'`

- [ ] **Step 3: 멱등 구현** — `backend/utils/slack_links.py` (이 단계는 멱등만; 연결 CRUD는 Phase 3)
```python
"""Slack 연결/멱등 저장 (ENV=local은 메모리, production은 DynamoDB+TTL)."""
import os, time

ENV = os.getenv("ENV", "local")
_local_events = set()

def mark_event_seen(event_key: str, ttl_seconds: int = 3600) -> bool:
    """처음 보는 이벤트면 True(기록), 이미 본 이벤트면 False. 중복 처리 방지."""
    if ENV == "local":
        if event_key in _local_events:
            return False
        _local_events.add(event_key)
        return True
    import boto3
    from botocore.exceptions import ClientError
    table = boto3.resource("dynamodb").Table(os.getenv("SLACK_EVENTS_TABLE", "sgu-pj-03-slack-events"))
    try:
        table.put_item(
            Item={"event_key": event_key, "ttl": int(time.time()) + ttl_seconds},
            ConditionExpression="attribute_not_exists(event_key)",
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
```

- [ ] **Step 4: 통과 확인**
Run: `cd backend && ENV=local PYTHONUTF8=1 python tests/test_dedup.py`
Expected: `OK`

- [ ] **Step 5: slack-handler 작성** — `backend/handlers/slack_handler.py`
```python
"""POST /slack/events — Slack 이벤트 진입점. 서명검증 → challenge/ack → SQS enqueue."""
import os, json, boto3
from utils.slack import verify_signature
from utils.slack_links import mark_event_seen

def _secret():
    if os.getenv("ENV") == "local":
        return {"signing_secret": os.getenv("SLACK_SIGNING_SECRET", "")}
    sm = boto3.client("secretsmanager")
    return json.loads(sm.get_secret_value(SecretId=os.getenv("SLACK_SECRET_ID", "sgu-pj-03/slack"))["SecretString"])

def _resp(code, body="ok"):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": body if isinstance(body, str) else json.dumps(body)}

def handle(event, context=None):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    raw = event.get("body") or ""
    sec = _secret()
    if not verify_signature(sec["signing_secret"], raw, headers.get("x-slack-request-timestamp", ""), headers.get("x-slack-signature", "")):
        return _resp(401, "bad signature")
    payload = json.loads(raw or "{}")
    if payload.get("type") == "url_verification":          # Slack URL 등록 챌린지
        return _resp(200, payload.get("challenge", ""))
    ev = payload.get("event", {})
    if ev.get("type") == "file_shared":
        # event_id로 멱등 (Slack 재시도 대비) → 신규일 때만 enqueue
        if mark_event_seen(payload.get("event_id", ev.get("file_id", ""))):
            boto3.client("sqs").send_message(
                QueueUrl=os.environ["SLACK_QUEUE_URL"],
                MessageBody=json.dumps({"file_id": ev.get("file_id"), "user_id": ev.get("user_id"), "channel_id": ev.get("channel_id"), "event_ts": ev.get("event_ts")}),
            )
    return _resp(200, "ok")   # 3초 내 즉시 ack
```

- [ ] **Step 6: Commit**
```bash
git add backend/handlers/slack_handler.py backend/utils/slack_links.py backend/tests/test_dedup.py
git commit -m "feat(slack): 이벤트 진입점(서명검증·challenge·멱등·SQS enqueue)"
```

### Task 3: slack-handler 배포 + Slack Event URL 등록 (사용자)
- [ ] CloudShell: 새 Lambda `sgu-pj-03-slack-handler` 생성(핸들러 `handlers.slack_handler.handle`), 코드 zip 업로드(`handlers utils`), env: `SLACK_QUEUE_URL`, `SLACK_SECRET_ID=sgu-pj-03/slack`, `SLACK_EVENTS_TABLE`
- [ ] API Gateway `7al1rzghkf`에 리소스 `/slack/events`(POST, Lambda Proxy) 생성 → CORS 불필요(서버-서버) → prod 배포
- [ ] Slack 앱 → Event Subscriptions → Request URL에 `.../prod/slack/events` 입력 → "Verified" 확인 → `file_shared` 이벤트 구독 → 재설치
- [ ] 검증: 채널에 파일 업로드 → CloudWatch에서 slack-handler 로그 + SQS 메시지 도착 확인

---

## Phase 2 — slack-worker (파일 다운로드 → S3 업로드 경로)

### Task 4: Slack 파일 다운로드 (`utils/slack.py` 확장)

**Files:**
- Modify: `backend/utils/slack.py`

- [ ] **Step 1: 구현 추가** — `backend/utils/slack.py` 끝에
```python
def _api(method: str, token: str, params: dict) -> dict:
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(f"https://slack.com/api/{method}", data=data,
                                 headers={"Authorization": f"Bearer {token}"})
    return json.loads(urllib.request.urlopen(req).read().decode())

def get_file_info(token: str, file_id: str) -> dict:
    r = _api("files.info", token, {"file": file_id})
    if not r.get("ok"):
        raise RuntimeError(f"files.info 실패: {r.get('error')}")
    return r["file"]

def download_file(token: str, url_private_download: str) -> bytes:
    req = urllib.request.Request(url_private_download, headers={"Authorization": f"Bearer {token}"})
    return urllib.request.urlopen(req).read()

def post_message(token: str, channel: str, thread_ts: str, text: str, blocks=None) -> dict:
    payload = {"channel": channel, "thread_ts": thread_ts, "text": text}
    if blocks:
        payload["blocks"] = json.dumps(blocks)
    return _api("chat.postMessage", token, payload)
```

- [ ] **Step 2: import 스모크** (구문 확인)
Run: `cd backend && python -c "import utils.slack"`
Expected: 에러 없음

- [ ] **Step 3: Commit**
```bash
git add backend/utils/slack.py
git commit -m "feat(slack): files.info/다운로드/chat.postMessage"
```

### Task 5: slack-worker (SQS 소비 → S3 업로드 경로)

**Files:**
- Create: `backend/handlers/slack_worker.py`

- [ ] **Step 1: 구현** — `backend/handlers/slack_worker.py`
```python
"""SQS 소비: Slack 파일을 받아 기존 업로드 경로(process)에 투입.
연결 여부에 따라 user_id(이메일) 결정. 미연결이면 연결 안내 답글 + anonymous 처리."""
import os, json, boto3
from utils.slack import get_file_info, download_file, post_message
from utils.slack_links import get_link
from handlers.upload_handler import process

def _secret():
    sm = boto3.client("secretsmanager")
    return json.loads(sm.get_secret_value(SecretId=os.getenv("SLACK_SECRET_ID", "sgu-pj-03/slack"))["SecretString"])

def handle(event, context=None):
    sec = _secret(); token = sec["bot_token"]
    for record in event.get("Records", []):
        msg = json.loads(record["body"])
        info = get_file_info(token, msg["file_id"])
        filename = info.get("name", "slack_file")
        data = download_file(token, info["url_private_download"])
        link = get_link(msg["user_id"])           # {email, ...} 또는 None
        user_id = link["email"] if link else f"slack:{msg['user_id']}"
        result = process(filename, data, user_id, extra={
            "source": "slack", "slack_channel": msg["channel_id"], "slack_thread_ts": msg["event_ts"],
        })
        if not result.get("success"):
            post_message(token, msg["channel_id"], msg["event_ts"], f"⚠️ 업로드 실패: {result.get('message')}")
```

- [ ] **Step 2: `process`에 extra 메타 지원** — `backend/handlers/upload_handler.py` `process()` 시그니처 수정
Modify `def process(filename, file_bytes, user_id="local_user"):` →
```python
def process(filename: str, file_bytes: bytes, user_id: str = "local_user", extra: dict = None) -> dict:
    ...
    doc_data = dataclasses.asdict(doc)
    doc_data["file_path"] = file_path
    if extra:
        doc_data.update(extra)   # source/slack_channel/slack_thread_ts
    save_document(doc.doc_id, doc_data)
    ...
```
(기존 호출부는 extra 없이 그대로 동작)

- [ ] **Step 3: import 스모크**
Run: `cd backend && python -c "import handlers.slack_worker"`
Expected: 에러 없음 (boto3 필요 — CloudShell/Lambda에서, 로컬 실패 시 무시)

- [ ] **Step 4: Commit**
```bash
git add backend/handlers/slack_worker.py backend/handlers/upload_handler.py
git commit -m "feat(slack): SQS 워커 — Slack 파일을 기존 업로드 경로에 투입"
```

### Task 6: slack-worker 배포 + SQS 트리거 (사용자)
- [ ] Lambda `sgu-pj-03-slack-worker` 생성(핸들러 `handlers.slack_worker.handle`), env: `SLACK_SECRET_ID`, `S3_BUCKET`, `DOCUMENTS_TABLE`, `SLACK_LINKS_TABLE`
- [ ] SQS `sgu-pj-03-slack-jobs`를 이벤트 소스로 연결(배치 1)
- [ ] 검증: 연결 전 상태로 파일 업로드 → S3/DynamoDB에 doc 생성(`source=slack`) 확인 (이 시점엔 캘린더·정상 알림은 Phase 3·4)

---

## Phase 3 — 계정 연결 (OAuth offline)

### Task 7: state HMAC + Google 토큰 교환 (`utils/slack_oauth.py`)

**Files:**
- Create: `backend/utils/slack_oauth.py`
- Test: `backend/tests/test_oauth_state.py`

- [ ] **Step 1: 실패 테스트** — `backend/tests/test_oauth_state.py`
```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.slack_oauth import sign_state, verify_state

SECRET = "statesecret"

def test_roundtrip():
    s = sign_state(SECRET, "U123", "C1", "169.7")
    ok, data = verify_state(SECRET, s)
    assert ok and data["slack_user_id"] == "U123" and data["channel"] == "C1"

def test_tampered():
    s = sign_state(SECRET, "U123", "C1", "169.7")
    ok, _ = verify_state(SECRET, s[:-2] + ("00" if not s.endswith("00") else "11"))
    assert ok is False

def test_expired():
    s = sign_state(SECRET, "U123", "C1", "169.7", issued_at=0)
    ok, _ = verify_state(SECRET, s, max_age=60)
    assert ok is False

if __name__ == "__main__":
    test_roundtrip(); test_tampered(); test_expired(); print("OK")
```

- [ ] **Step 2: 실패 확인**
Run: `cd backend && PYTHONUTF8=1 python tests/test_oauth_state.py`
Expected: `ImportError`

- [ ] **Step 3: 구현** — `backend/utils/slack_oauth.py`
```python
"""OAuth state HMAC 서명/검증 + Google 토큰 교환(stdlib만)."""
import hmac, hashlib, time, json, base64, urllib.request, urllib.parse

def _b64e(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
def _b64d(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def sign_state(secret: str, slack_user_id: str, channel: str, thread_ts: str, issued_at: int = None) -> str:
    payload = {"slack_user_id": slack_user_id, "channel": channel, "thread_ts": thread_ts, "iat": issued_at if issued_at is not None else int(time.time())}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64e(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"

def verify_state(secret: str, state: str, max_age: int = 600):
    try:
        body, sig = state.split(".", 1)
        expected = _b64e(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig):
            return False, None
        data = json.loads(_b64d(body))
        if int(time.time()) - int(data["iat"]) > max_age:
            return False, None
        return True, data
    except Exception:
        return False, None

def exchange_code(client_id, client_secret, redirect_uri, code) -> dict:
    """authorization code → {access_token, refresh_token, id_token...}"""
    data = urllib.parse.urlencode({"code": code, "client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri, "grant_type": "authorization_code"}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())

def refresh_access_token(client_id, client_secret, refresh_token) -> str:
    data = urllib.parse.urlencode({"client_id": client_id, "client_secret": client_secret, "refresh_token": refresh_token, "grant_type": "refresh_token"}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())["access_token"]

def email_from_id_token(id_token: str) -> str:
    payload = id_token.split(".")[1]
    return json.loads(_b64d(payload)).get("email", "")
```

- [ ] **Step 4: 통과 확인**
Run: `cd backend && PYTHONUTF8=1 python tests/test_oauth_state.py`
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add backend/utils/slack_oauth.py backend/tests/test_oauth_state.py
git commit -m "feat(slack): OAuth state HMAC + Google 토큰 교환"
```

### Task 8: slack-links CRUD (KMS 암복호)

**Files:**
- Modify: `backend/utils/slack_links.py` (Phase 1의 멱등에 연결 CRUD 추가)

- [ ] **Step 1: 구현 추가** — `backend/utils/slack_links.py` 끝에
```python
def _kms_encrypt(plaintext: str) -> str:
    import boto3, base64
    blob = boto3.client("kms").encrypt(KeyId=os.environ["SLACK_KMS_KEY"], Plaintext=plaintext.encode())["CiphertextBlob"]
    return base64.b64encode(blob).decode()

def _kms_decrypt(ciphertext_b64: str) -> str:
    import boto3, base64
    return boto3.client("kms").decrypt(CiphertextBlob=base64.b64decode(ciphertext_b64))["Plaintext"].decode()

_local_links = {}

def save_link(slack_user_id: str, email: str, refresh_token: str):
    import time
    if ENV == "local":
        _local_links[slack_user_id] = {"slack_user_id": slack_user_id, "email": email, "refresh_token": refresh_token}
        return
    import boto3
    boto3.resource("dynamodb").Table(os.getenv("SLACK_LINKS_TABLE", "sgu-pj-03-slack-links")).put_item(
        Item={"slack_user_id": slack_user_id, "email": email, "refresh_token_enc": _kms_encrypt(refresh_token), "linked_at": int(time.time())})

def get_link(slack_user_id: str):
    """{email, refresh_token} 또는 None"""
    if ENV == "local":
        return _local_links.get(slack_user_id)
    import boto3
    item = boto3.resource("dynamodb").Table(os.getenv("SLACK_LINKS_TABLE", "sgu-pj-03-slack-links")).get_item(Key={"slack_user_id": slack_user_id}).get("Item")
    if not item:
        return None
    return {"email": item["email"], "refresh_token": _kms_decrypt(item["refresh_token_enc"])}

def delete_link(slack_user_id: str):
    if ENV == "local":
        _local_links.pop(slack_user_id, None); return
    import boto3
    boto3.resource("dynamodb").Table(os.getenv("SLACK_LINKS_TABLE", "sgu-pj-03-slack-links")).delete_item(Key={"slack_user_id": slack_user_id})
```

- [ ] **Step 2: 로컬 라운드트립 테스트** — `backend/tests/test_dedup.py`에 추가
```python
def test_link_roundtrip():
    from utils.slack_links import save_link, get_link, delete_link
    save_link("U9", "a@b.com", "rt-xyz")
    assert get_link("U9")["email"] == "a@b.com"
    assert get_link("U9")["refresh_token"] == "rt-xyz"
    delete_link("U9"); assert get_link("U9") is None
```
그리고 `__main__`에 `test_link_roundtrip()` 추가.

- [ ] **Step 3: 통과 확인**
Run: `cd backend && ENV=local PYTHONUTF8=1 python tests/test_dedup.py`
Expected: `OK`

- [ ] **Step 4: Commit**
```bash
git add backend/utils/slack_links.py backend/tests/test_dedup.py
git commit -m "feat(slack): slack-links CRUD(KMS 암복호) + 로컬 테스트"
```

### Task 9: google-oauth-callback 핸들러 + 연결 안내

**Files:**
- Create: `backend/handlers/google_oauth_handler.py`
- Modify: `backend/handlers/slack_worker.py` (미연결 시 연결 링크 게시)

- [ ] **Step 1: 콜백 핸들러** — `backend/handlers/google_oauth_handler.py`
```python
"""GET /slack/google/callback — code→토큰 교환, refresh token 저장, Slack에 연결완료 답글."""
import os, json, boto3
from utils.slack_oauth import verify_state, exchange_code, email_from_id_token
from utils.slack_links import save_link
from utils.slack import post_message

def _sec():
    return json.loads(boto3.client("secretsmanager").get_secret_value(SecretId=os.getenv("SLACK_SECRET_ID", "sgu-pj-03/slack"))["SecretString"])

def _html(msg):
    return {"statusCode": 200, "headers": {"Content-Type": "text/html; charset=utf-8"}, "body": f"<html><body style='font-family:sans-serif;text-align:center;padding:40px'>{msg}<br>이 창을 닫아도 됩니다.</body></html>"}

def handle(event, context=None):
    q = event.get("queryStringParameters") or {}
    sec = _sec()
    ok, st = verify_state(sec["signing_secret"], q.get("state", ""))
    if not ok:
        return _html("⚠️ 잘못되었거나 만료된 요청입니다.")
    redirect_uri = f"https://{event['requestContext']['domainName']}/{event['requestContext']['stage']}/slack/google/callback"
    tok = exchange_code(sec["google_client_id"], sec["google_client_secret"], redirect_uri, q.get("code"))
    if "refresh_token" not in tok:
        return _html("⚠️ 연결 실패: 다시 시도해주세요(이미 연결된 계정이면 Google 권한 페이지에서 제거 후 재시도).")
    email = email_from_id_token(tok.get("id_token", "")) or "이메일미상"
    save_link(st["slack_user_id"], email, tok["refresh_token"])
    post_message(sec["bot_token"], st["channel"], st["thread_ts"], f"✅ Google 계정({email}) 연결 완료! 이제 올리는 문서의 일정이 캘린더에 자동 등록됩니다.")
    return _html(f"✅ {email} 연결 완료!")
```

- [ ] **Step 2: 미연결 시 연결 링크 게시** — `backend/handlers/slack_worker.py`의 `link is None` 분기에서 OAuth 링크 답글 추가
```python
from utils.slack_oauth import sign_state
import urllib.parse
...
if link is None:
    state = sign_state(sec["signing_secret"], msg["user_id"], msg["channel_id"], msg["event_ts"])
    redirect = f"{os.environ['API_BASE']}/slack/google/callback"
    auth = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": sec["google_client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": "https://www.googleapis.com/auth/calendar.events email", "access_type": "offline", "prompt": "consent", "state": state})
    post_message(token, msg["channel_id"], msg["event_ts"], f"📎 분석은 진행됩니다. 캘린더 자동 등록을 원하면 Google 계정을 연결하세요: {auth}")
```
(분석은 계속 진행 — `process(...)` 호출은 그대로 두고 위 안내만 추가)

- [ ] **Step 3: import 스모크**
Run: `cd backend && python -c "import handlers.google_oauth_handler"`
Expected: 에러 없음

- [ ] **Step 4: Commit**
```bash
git add backend/handlers/google_oauth_handler.py backend/handlers/slack_worker.py
git commit -m "feat(slack): Google OAuth 콜백 + 미연결 시 연결 안내"
```

### Task 10: 콜백 배포 + 연결 E2E (사용자)
- [ ] Lambda `sgu-pj-03-google-oauth` 생성(핸들러 `handlers.google_oauth_handler.handle`), env: `SLACK_SECRET_ID`, `SLACK_LINKS_TABLE`, `SLACK_KMS_KEY`
- [ ] API Gateway `/slack/google/callback`(GET, Lambda Proxy) 생성 → prod 배포
- [ ] slack-worker env에 `API_BASE=https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod` 추가
- [ ] 검증: 미연결 상태로 파일 업로드 → 스레드에 연결 링크 → 클릭·동의 → "연결 완료" 답글 + slack-links에 항목 생성 확인

---

## Phase 4 — 캘린더 자동 등록 + 스레드 알림

### Task 11: 파이프라인 종료 시 Slack 통지 + 개인 캘린더 등록

**Files:**
- Modify: `backend/handlers/action_handler.py`

- [ ] **Step 1: Slack 통지 함수 추가** — `backend/handlers/action_handler.py`
```python
def notify_slack_done(doc: dict):
    """source=slack 문서의 분석 완료 시 스레드 답글 + 연결돼 있으면 개인 캘린더 등록."""
    if doc.get("source") != "slack":
        return
    import os, json, boto3
    from utils.slack import post_message
    from utils.slack_links import get_link
    sec = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId=os.getenv("SLACK_SECRET_ID", "sgu-pj-03/slack"))["SecretString"])
    token, ch, ts = sec["bot_token"], doc["slack_channel"], doc["slack_thread_ts"]
    a = doc.get("analysis", {})
    dls = a.get("deadlines", [])
    reqs = a.get("required_documents", [])
    lines = [f"*{a.get('document_type','문서')}* 분석 완료"]
    if dls:
        lines.append("📅 마감: " + ", ".join(f"{d.get('date')} {d.get('description','')}" for d in dls))
    if reqs:
        lines.append("📄 필요서류: " + ", ".join(r.get("name","") for r in reqs))

    # 개인 캘린더 등록 (연결된 경우)
    user_id = doc.get("user_id", "")
    cal_done = ""
    link = get_link_by_email(user_id)   # email 기반 역조회 (아래 Step 2)
    if link:
        try:
            from utils.slack_oauth import refresh_access_token
            access = refresh_access_token(sec["google_client_id"], sec["google_client_secret"], link["refresh_token"])
            r = handle_calendar(doc["doc_id"], access)
            cal_done = f"\n🗓️ 캘린더 {r.get('count',0)}건 등록 완료"
        except Exception as e:
            cal_done = "\n⚠️ 캘린더 등록 실패(연결 만료 시 재연결 필요)"
    post_message(token, ch, ts, "\n".join(lines) + cal_done)
```

- [ ] **Step 2: email 기반 역조회** — `backend/utils/slack_links.py`에 추가 (production은 GSI 또는 scan; 내부용이라 scan 허용)
```python
def get_link_by_email(email: str):
    if ENV == "local":
        for v in _local_links.values():
            if v["email"] == email:
                return v
        return None
    import boto3
    table = boto3.resource("dynamodb").Table(os.getenv("SLACK_LINKS_TABLE", "sgu-pj-03-slack-links"))
    for it in table.scan(FilterExpression="email = :e", ExpressionAttributeValues={":e": email}).get("Items", []):
        return {"email": it["email"], "refresh_token": _kms_decrypt(it["refresh_token_enc"])}
    return None
```

- [ ] **Step 3: 파이프라인 종료 훅 연결** — ai-analyzer가 분석 저장 후 `notify_slack_done(doc)` 호출하도록 연결. (ai-analyzer가 action-executor를 호출하는 기존 경로가 있으면 거기서, 없으면 ai-analyzer 끝에 `from handlers.action_handler import notify_slack_done; notify_slack_done(doc)` 추가)
Run(로컬 구문): `cd backend && python -c "import handlers.action_handler"`
Expected: 에러 없음

- [ ] **Step 4: Commit**
```bash
git add backend/handlers/action_handler.py backend/utils/slack_links.py
git commit -m "feat(slack): 분석 완료 스레드 알림 + 개인 캘린더 자동 등록"
```

### Task 12: 배포 + 전체 E2E (사용자)
- [ ] ai-analyzer / action-executor Lambda 재배포(변경분 포함), env에 `SLACK_SECRET_ID`·`SLACK_LINKS_TABLE`·`SLACK_KMS_KEY` 추가
- [ ] **E2E**: 연결된 사용자가 테스트 워크스페이스 채널에 행정문서 업로드 → 스레드에 분석요약·마감·필요서류 답글 + 본인 Google 캘린더에 일정 등록 확인
- [ ] 미연결 사용자 업로드 → 연결 링크 → 연결 후 재업로드 → 자동 등록 확인

---

## Phase 5 — 에러·엣지 마감

### Task 13: 엣지케이스 처리
- [ ] 미지원 형식·20MB 초과: `process()`가 이미 `success:false` 반환 → slack-worker가 스레드에 사유 답글(Task 5 Step1에 포함됨, 메시지 문구 점검)
- [ ] refresh token 만료/철회: Task 11의 캘린더 등록 except에서 `delete_link` 호출 + "재연결: <링크>" 답글 추가
```python
except Exception as e:
    from utils.slack_links import delete_link
    # 토큰 무효로 판단되면 연결 삭제 + 재연결 유도
    cal_done = "\n⚠️ Google 연결이 만료됐어요. 다음 업로드 시 재연결 링크를 드릴게요."
```
- [ ] DLQ 모니터링: SQS DLQ에 쌓이는 메시지 알림(CloudWatch 알람) — 선택
- [ ] Commit:
```bash
git add backend/handlers/action_handler.py backend/handlers/slack_worker.py
git commit -m "feat(slack): 엣지케이스(미지원 형식·토큰 만료) 처리"
```

---

## Self-Review 결과

- **Spec 커버리지**: 트리거(Task 3)·파일→파이프라인(Task 5)·개인 캘린더(Task 11)·스레드 알림(Task 11)·계정연결(Task 7~10)·신원통합 user_id=email(Task 5,11)·보안 서명·HMAC·KMS(Task 1,7,8)·멱등(Task 2)·에러(Task 13)·인프라(Phase 0) — 전부 매핑됨.
- **플레이스홀더**: 코드 단계는 실제 코드 포함. Phase 0/배포 단계의 `<KEY_ID>`/`<...>`는 사용자 입력값(불가피).
- **타입 일관성**: `get_link`(slack_user_id)→{email,refresh_token}, `get_link_by_email`(email)→동형, `save_link`/`delete_link`, `mark_event_seen`, `verify_signature`, `sign_state`/`verify_state`, `process(...,extra=)`, `handle_calendar(doc_id, token)`(기존 시그니처와 일치) — 교차 확인 완료.

## 알려진 제약/주의

- **IAM(Phase 0-4)에서 막히면 전체 보류** — SES 전례. 착수 전 권한 확보가 최우선.
- 분석 완료 훅(Task 11 Step3)은 기존 ai-analyzer↔action-executor 연결 방식 확인 후 정확한 지점에 삽입 필요(코드 읽고 결정).
- `get_link_by_email` scan은 내부 소규모 가정. 사용자 많아지면 email-index GSI로 교체.
