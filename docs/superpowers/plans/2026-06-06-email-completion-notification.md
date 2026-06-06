# 문서 완료 이메일 알림 (SNS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일 가입 유저가 업로드한 문서 분석이 완료되면 가입 이메일로 SNS 알림을 보낸다.

**Architecture:** 단일 SNS 토픽 + 구독별 `user_id` FilterPolicy로 개인 타겟. 신규 `utils/notify_email.py`가 구독(`subscribe_user`)과 발행(`notify_done`)을 best-effort로 담당하고, `auth_handler`(가입/로그인)와 `ai_handler`(완료)에 얇은 훅만 추가. SES는 IAM 차단이라 미사용.

**Tech Stack:** Python 3.11 stdlib + boto3(sns), 기존 테스트 컨벤션(`backend/tests/test_*.py`, `sys.path.insert`, `__main__` 러너, `python tests/<f>.py`로 직접 실행). ENV=local·boto3 monkeypatch로 AWS 없이 검증.

---

## File Structure

- `backend/utils/notify_email.py` — **신규**. SNS 구독/발행 단일 책임. ENV=local·토픽 미설정이면 no-op.
- `backend/handlers/auth_handler.py` — **수정**. `signup`(구독+플래그), `login`(기존 유저 지연 구독) 훅.
- `backend/handlers/ai_handler.py` — **수정**. 분석 완료 직후 `notify_email_done(doc)` 훅.
- `backend/tests/test_notify_email.py` — **신규**. notify_email 모듈 단위 테스트(ENV 토글 + fake boto3).
- `backend/tests/test_notify_hooks.py` — **신규**. auth_handler 훅 테스트(ENV=local + LOCAL_PEPPER + fake subscribe_user).
- `scripts/setup_notify_topic.md` — **신규**. 일회성 셋업 런북(토픽 생성·env 설정·역할 프리체크).

---

### Task 1: `utils/notify_email.py` 모듈

**Files:**
- Create: `backend/utils/notify_email.py`
- Test: `backend/tests/test_notify_email.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_notify_email.py`:

```python
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils import notify_email

_calls = {}
class _FakeSNS:
    def subscribe(self, **kw): _calls["subscribe"] = kw; return {"SubscriptionArn": "pending confirmation"}
    def publish(self, **kw): _calls["publish"] = kw; return {"MessageId": "m1"}
import boto3
boto3.client = lambda *a, **k: _FakeSNS()

TOPIC = "arn:aws:sns:ap-northeast-2:443370697536:littleboss-user-notifications"

def _prod():
    os.environ["ENV"] = "production"
    os.environ["USER_NOTIFY_TOPIC_ARN"] = TOPIC

def _reset():
    _calls.clear()

def test_local_noop():
    _reset()
    os.environ["ENV"] = "local"
    assert notify_email.subscribe_user("a@b.com", "a@b.com") is False
    assert notify_email.notify_done({"user_id": "a@b.com", "analysis": {}}) is False
    assert "subscribe" not in _calls and "publish" not in _calls

def test_subscribe_calls_sns_with_filter():
    _reset(); _prod()
    assert notify_email.subscribe_user("a@b.com", "a@b.com") is True
    kw = _calls["subscribe"]
    assert kw["Protocol"] == "email" and kw["Endpoint"] == "a@b.com"
    assert json.loads(kw["Attributes"]["FilterPolicy"]) == {"user_id": ["a@b.com"]}

def test_notify_done_publishes_with_attr_and_ascii_subject():
    _reset(); _prod()
    notify_email.get_user = lambda uid: {"notif_settings": {"mail": True}}
    doc = {"doc_id": "d1", "user_id": "a@b.com", "analysis": {
        "document_type": "국가장학금", "deadlines": [{"date": "2026-06-30", "description": "신청 마감"}],
        "required_documents": [{"name": "주민등록등본"}]}}
    assert notify_email.notify_done(doc) is True
    kw = _calls["publish"]
    assert kw["MessageAttributes"]["user_id"]["StringValue"] == "a@b.com"
    assert kw["Subject"].isascii() and len(kw["Subject"]) <= 100
    assert "신청 마감" in kw["Message"] and "주민등록등본" in kw["Message"]

def test_notify_done_respects_mail_off():
    _reset(); _prod()
    notify_email.get_user = lambda uid: {"notif_settings": {"mail": False}}
    assert notify_email.notify_done({"user_id": "a@b.com", "analysis": {}}) is False
    assert "publish" not in _calls

def test_notify_done_no_user_id():
    _reset(); _prod()
    notify_email.get_user = lambda uid: None
    assert notify_email.notify_done({"analysis": {}}) is False
    assert "publish" not in _calls

if __name__ == "__main__":
    test_local_noop()
    test_subscribe_calls_sns_with_filter()
    test_notify_done_publishes_with_attr_and_ascii_subject()
    test_notify_done_respects_mail_off()
    test_notify_done_no_user_id()
    print("OK")
```

- [ ] **Step 2: 실패 확인** — From `backend`: `python tests/test_notify_email.py`
Expected: FAIL — `ImportError`/`ModuleNotFoundError: utils.notify_email`.

- [ ] **Step 3: 구현** — `backend/utils/notify_email.py`:

```python
"""
문서 완료 이메일 알림 (SNS).
SES가 IAM 차단이라 SNS 단일 토픽 + user_id 필터 정책으로 개인 타겟.
- subscribe_user: 가입/로그인 시 1회, 이메일을 토픽에 구독(FilterPolicy=user_id).
- notify_done: 분석 완료 시 해당 user_id에게만 Publish.
전부 best-effort: 실패해도 호출부(가입/분석)는 안 깨진다.
ENV=local 또는 USER_NOTIFY_TOPIC_ARN 미설정이면 no-op(False).
"""
import os
import json
from utils.storage import get_user

# SNS Subject는 ASCII만 허용(≤100자, 줄바꿈/제어문자 불가) — 한글 내용은 본문에만.
_SUBJECT = "LittleBoss - document analysis complete"


def _topic_arn():
    return os.getenv("USER_NOTIFY_TOPIC_ARN")


def subscribe_user(email: str, user_id: str) -> bool:
    """이메일을 알림 토픽에 구독(FilterPolicy=user_id). 성공 시 True, 아니면 False(no-op 포함)."""
    arn = _topic_arn()
    if os.getenv("ENV", "local") == "local" or not arn or not email or not user_id:
        return False
    try:
        import boto3
        boto3.client("sns").subscribe(
            TopicArn=arn,
            Protocol="email",
            Endpoint=email,
            Attributes={"FilterPolicy": json.dumps({"user_id": [str(user_id)]})},
            ReturnSubscriptionArn=True,
        )
        return True
    except Exception as e:
        print(f"[NOTIFY_SUBSCRIBE_ERROR] {email}: {e}")
        return False


def _build_message(doc: dict) -> str:
    a = doc.get("analysis", {}) or {}
    doc_type = a.get("document_type", "문서")
    lines = [f"'{doc_type}' 문서 분석이 완료되었습니다.", ""]
    dls = a.get("deadlines", []) or []
    if dls:
        lines.append("[마감 일정]")
        for d in dls:
            lines.append(f"- {d.get('date', '')} {d.get('description', '')}".rstrip())
        lines.append("")
    reqs = a.get("required_documents", []) or []
    if reqs:
        lines.append("[필요 서류]")
        for r in reqs:
            lines.append(f"- {r.get('name', '')}")
        lines.append("")
    lines.append("LittleBoss 앱에서 자세한 내용을 확인하세요.")
    return "\n".join(lines)


def notify_done(doc: dict) -> bool:
    """문서 분석 완료 시 해당 user_id에게만 알림 Publish. 발행 시 True, 아니면 False."""
    arn = _topic_arn()
    if os.getenv("ENV", "local") == "local" or not arn or not doc:
        return False
    user_id = doc.get("user_id", "")
    if not user_id:
        return False
    try:
        u = get_user(user_id)
        if u and u.get("notif_settings", {}).get("mail", True) is False:
            return False
        import boto3
        boto3.client("sns").publish(
            TopicArn=arn,
            Subject=_SUBJECT,
            Message=_build_message(doc),
            MessageAttributes={"user_id": {"DataType": "String", "StringValue": str(user_id)}},
        )
        return True
    except Exception as e:
        print(f"[EMAIL_NOTIFY_ERROR] {doc.get('doc_id')}: {e}")
        return False
```

- [ ] **Step 4: 통과 확인** — `python tests/test_notify_email.py` → `OK`.

- [ ] **Step 5: 커밋**
```bash
git add backend/utils/notify_email.py backend/tests/test_notify_email.py
git commit -m "feat(notify): SNS 문서완료 이메일 알림 유틸(notify_email)"
```

---

### Task 2: `auth_handler` 가입/로그인 구독 훅

**Files:**
- Modify: `backend/handlers/auth_handler.py` (import + `signup` + `login`)
- Test: `backend/tests/test_notify_hooks.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_notify_hooks.py`:

```python
import os, sys
os.environ["ENV"] = "local"
os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils import pepper
from handlers import auth_handler

pepper.reset_cache()

_STORE = {}
auth_handler.get_user = lambda uid: _STORE.get(uid)
auth_handler.save_user = lambda d: _STORE.__setitem__(d["user_id"], d)


def test_signup_subscribes_and_flags():
    _STORE.clear()
    pepper.reset_cache()
    called = {}
    def fake_sub(email, uid):
        called["args"] = (email, uid); return True
    auth_handler.subscribe_user = fake_sub
    r = auth_handler.signup("홍길동", "a@b.com", "password123")
    assert r["success"] is True
    assert called["args"] == ("a@b.com", "a@b.com")
    assert _STORE["a@b.com"]["notify_email_subscribed"] is True


def test_login_lazy_subscribe_existing_user():
    _STORE.clear()
    pepper.reset_cache()
    salt = "deadbeefdeadbeefdeadbeefdeadbeef"
    _STORE["old@b.com"] = {
        "user_id": "old@b.com", "email": "old@b.com", "name": "구",
        "password_hash": auth_handler._secure_hash("legacy123", salt), "salt": salt,
        "hash_version": auth_handler.HASH_VERSION, "auth_type": "email",
    }
    called = {}
    def fake_sub(email, uid):
        called["args"] = (email, uid); return True
    auth_handler.subscribe_user = fake_sub
    r = auth_handler.login("old@b.com", "legacy123")
    assert r["success"] is True
    assert called["args"] == ("old@b.com", "old@b.com")
    assert _STORE["old@b.com"]["notify_email_subscribed"] is True


def test_login_skips_subscribe_when_already_flagged():
    _STORE.clear()
    pepper.reset_cache()
    salt = "feedfacefeedfacefeedfacefeedface"
    _STORE["x@b.com"] = {
        "user_id": "x@b.com", "email": "x@b.com", "name": "x",
        "password_hash": auth_handler._secure_hash("pw12345678", salt), "salt": salt,
        "hash_version": auth_handler.HASH_VERSION, "auth_type": "email",
        "notify_email_subscribed": True,
    }
    called = {"n": 0}
    def fake_sub(email, uid):
        called["n"] += 1; return True
    auth_handler.subscribe_user = fake_sub
    assert auth_handler.login("x@b.com", "pw12345678")["success"] is True
    assert called["n"] == 0  # 이미 구독됨 → 재호출 안 함


if __name__ == "__main__":
    test_signup_subscribes_and_flags()
    test_login_lazy_subscribe_existing_user()
    test_login_skips_subscribe_when_already_flagged()
    print("OK")
```

- [ ] **Step 2: 실패 확인** — From `backend`: `python tests/test_notify_hooks.py`
Expected: FAIL — `AttributeError: module 'handlers.auth_handler' has no attribute 'subscribe_user'` (import 미존재) 또는 `notify_email_subscribed` 미저장 assert 실패.

- [ ] **Step 3: 구현** — `backend/handlers/auth_handler.py`:

(a) import 추가 — `from utils.pepper import apply_pepper` 아래에:
```python
from utils.notify_email import subscribe_user
```

(b) `signup`의 저장 부분 — `save_user({...})` 호출의 dict에 `notify_email_subscribed` 키 추가
(구독은 SNS만 쓰므로 DB 저장 전에 호출 가능). 현재:
```python
    salt = secrets.token_hex(16)
    save_user({
        "user_id": email,
        "email": email,
        "name": name,
        "password_hash": _secure_hash(password, salt),
        "salt": salt,
        "hash_version": HASH_VERSION,
        "auth_type": "email",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
```
을 다음으로:
```python
    salt = secrets.token_hex(16)
    save_user({
        "user_id": email,
        "email": email,
        "name": name,
        "password_hash": _secure_hash(password, salt),
        "salt": salt,
        "hash_version": HASH_VERSION,
        "auth_type": "email",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notify_email_subscribed": subscribe_user(email, email),  # best-effort(실패/로컬이면 False)
    })
```

(c) `login`의 성공 검증 직후(투명 마이그레이션 블록 아래, return 전)에 지연 구독 추가:
```python
    # 기존 가입자(구독 플래그 없음) 지연 구독 — best-effort
    if not user.get("notify_email_subscribed"):
        if subscribe_user(email, user["user_id"]):
            user["notify_email_subscribed"] = True
            save_user(user)
```

- [ ] **Step 4: 통과 확인** — From `backend`:
- `python tests/test_notify_hooks.py` → `OK`
- 회귀: `python tests/test_password_pepper.py` → `OK`

- [ ] **Step 5: 커밋**
```bash
git add backend/handlers/auth_handler.py backend/tests/test_notify_hooks.py
git commit -m "feat(notify): 가입/로그인 시 알림 이메일 구독 훅"
```

---

### Task 3: `ai_handler` 완료 알림 훅

**Files:**
- Modify: `backend/handlers/ai_handler.py` (`process`의 완료 직후)

- [ ] **Step 1: 훅 추가** — `backend/handlers/ai_handler.py`의 `process`에서, status=done 저장·Slack 알림 블록 뒤(`return {...success...}` 전)에 이메일 알림 훅을 추가한다. 현재 Slack 블록:
```python
        # Slack 출처 문서면 스레드 알림 + 개인 캘린더 등록 (실패해도 분석 성공은 유지)
        try:
            from handlers.action_handler import notify_slack_done
            notify_slack_done(doc)
        except Exception as e:
            print(f"[SLACK_NOTIFY_ERROR] {e}")
```
바로 아래에 추가:
```python
        # 이메일 가입 유저면 가입 이메일로 완료 알림 (best-effort)
        try:
            from utils.notify_email import notify_done as notify_email_done
            notify_email_done(doc)
        except Exception as e:
            print(f"[EMAIL_NOTIFY_ERROR] {e}")
```

- [ ] **Step 2: import·소스 확인** — From `backend`:
```bash
python -c "import sys; sys.path.insert(0,'.'); import ast; ast.parse(open('handlers/ai_handler.py',encoding='utf-8').read()); s=open('handlers/ai_handler.py',encoding='utf-8').read(); print('HOOK' if 'notify_email_done(doc)' in s else 'MISSING')"
```
Expected: `HOOK` (구문 정상 + 훅 존재).

- [ ] **Step 3: no-op 스모크** — `notify_email.notify_done`는 ENV=local에서 no-op이므로, 로컬에서 ai_handler를 import해도 부작용이 없음을 확인:
```bash
python -c "import os,sys; os.environ['ENV']='local'; sys.path.insert(0,'.'); from utils.notify_email import notify_done; print('NOOP' if notify_done({'user_id':'a@b.com','analysis':{}}) is False else 'FAIL')"
```
Expected: `NOOP`.

- [ ] **Step 4: 커밋**
```bash
git add backend/handlers/ai_handler.py
git commit -m "feat(notify): 분석 완료 시 이메일 알림 훅(ai_handler)"
```

---

### Task 4: 일회성 셋업 런북 + 역할 프리체크

**Files:**
- Create: `scripts/setup_notify_topic.md`

> 인프라 일회성. 코드 아님. 런북을 작성·커밋하고, 실제 AWS 작업은 사용자가 CloudShell에서 수행.

- [ ] **Step 1: 런북 작성** — `scripts/setup_notify_topic.md`:

````markdown
# 문서 완료 이메일 알림(SNS) 일회성 셋업

리전 `ap-northeast-2`. sgu-pj-03 CloudShell에서 실행.

## 1. 알림 토픽 생성
```bash
aws sns create-topic --name littleboss-user-notifications --region ap-northeast-2
# 출력된 TopicArn 복사 (예: arn:aws:sns:ap-northeast-2:443370697536:littleboss-user-notifications)
```

## 2. Lambda 환경변수 USER_NOTIFY_TOPIC_ARN 설정
구독은 upload-handler(가입/로그인), 발행은 ai-analyzer(완료)가 한다. 두 함수 모두에 설정.
⚠️ `update-function-configuration --environment`는 env 맵 전체를 덮어쓰므로 기존값과 jq merge 필수.

```bash
TOPIC_ARN="<위에서 복사한 ARN>"
for FN in sgu-pj-03-upload-handler sgu-pj-03-ai-analyzer; do
  ENVJSON=$(aws lambda get-function-configuration --function-name "$FN" \
    --region ap-northeast-2 --query 'Environment.Variables' --output json)
  MERGED=$(echo "$ENVJSON" | jq --arg t "$TOPIC_ARN" '. + {USER_NOTIFY_TOPIC_ARN: $t}')
  aws lambda update-function-configuration --function-name "$FN" \
    --region ap-northeast-2 --environment "Variables=$MERGED"
done
```
(함수명이 다르면 실제 이름으로 교체. ai-analyzer 정확한 함수명은 `aws lambda list-functions --query "Functions[].FunctionName"`로 확인.)

## 3. 람다 역할 권한 프리체크 (중요)
- upload-handler 역할에 `sns:Subscribe`, ai-analyzer 역할에 `sns:Publish` 필요.
- 역할 ARN 확인: `aws lambda get-function-configuration --function-name <FN> --query Role`.
- 막혀 있으면 관리자에게 해당 역할에 위 액션 추가 요청(자가 부여는 iam:PutRolePolicy 차단).
- Publish는 기존 `_publish_sns`가 이미 쓰므로 ai-analyzer엔 있을 가능성 큼. upload-handler의 Subscribe가 관건.

## 4. 코드 배포
backend/를 zip으로 묶어 upload-handler·ai-analyzer에 `update-function-code` 배포
(handlers+models+utils, __pycache__ 제외). notify_email.py가 zip에 포함되는지 확인.

## 5. 검증
이메일 신규 가입 → AWS "Subscription Confirmation" 메일 도착 → 확인 클릭 →
문서 업로드 → 분석 완료 시 가입 이메일로 "LittleBoss - document analysis complete" 수신.
````

- [ ] **Step 2: 커밋**
```bash
git add scripts/setup_notify_topic.md
git commit -m "docs(notify): SNS 알림 토픽 일회성 셋업 런북"
```

- [ ] **Step 3: (사용자 수행) 실제 셋업**
> 에이전트는 여기서 멈추고 사용자에게 런북대로 진행을 안내한다. 특히 3단계(upload-handler 역할의 `sns:Subscribe`)가 막혀 있으면 보고하고 권한 요청 절차로 넘어간다.

---

## Self-Review

**1. Spec coverage**
- 단일 토픽 + user_id 필터 → Task 1(subscribe FilterPolicy, publish MessageAttribute). ✓
- ENV=local/토픽 미설정 no-op → Task 1 + test_local_noop. ✓
- ASCII Subject / 한글 본문 → Task 1 `_SUBJECT` + `_build_message`, test asserts isascii. ✓
- 가입 시 구독 + 플래그 → Task 2 signup. ✓
- 로그인 지연 구독(기존 유저) → Task 2 login. ✓
- notif_settings.mail 게이팅 → Task 1 notify_done + test_respects_mail_off. ✓
- 완료 시 발행 훅 → Task 3 ai_handler. ✓
- best-effort(가입/분석 불변) → subscribe_user/notify_done 내부 try/except + 호출부 영향 없음. ✓
- 일회성 셋업 + 역할 프리체크 → Task 4 런북. ✓
- Google 유저 제외 → user_id가 이메일인 경우만 자연 매칭(필터), signup 훅만 사용. ✓

**2. Placeholder scan:** 모든 코드 단계에 실제 코드. TBD/TODO 없음. ✓

**3. Type/이름 일관성:** `subscribe_user(email, user_id)`, `notify_done(doc)`, `_build_message`, `_SUBJECT`, `USER_NOTIFY_TOPIC_ARN`, `notify_email_subscribed`, `_secure_hash`/`HASH_VERSION`(Task 2 테스트에서 사용, 기존 auth_handler에 존재) 정의·사용 일치. notify_email은 `get_user`를 모듈 top에서 import(테스트가 `notify_email.get_user` monkeypatch). ✓
