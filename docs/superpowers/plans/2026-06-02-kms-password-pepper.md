# KMS 페퍼 기반 비밀번호 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DynamoDB users 테이블이 유출돼도 KMS 키 없이는 비밀번호 해시를 복원할 수 없게, PBKDF2 출력에 KMS 보호 페퍼(HMAC)를 한 겹 추가한다.

**Architecture:** 신규 `utils/pepper.py`가 콜드스타트당 1회 `kms:Decrypt`로 평문 페퍼를 메모리에 캐시(로컬은 `LOCAL_PEPPER` 폴백). `auth_handler.py`는 `_secure_hash = HMAC(pepper, PBKDF2(...))`로 v2 해시를 저장하고, 기존 v1 유저는 로그인 성공 시 v2로 투명 승격한다. KMS 키/권한은 일회성 스크립트로 셋업(권한은 IAM이 아닌 KMS 키 정책으로 부여).

**Tech Stack:** Python 3.11 stdlib(`hashlib`, `hmac`, `secrets`, `base64`), boto3(`kms`), 기존 테스트 컨벤션(`backend/tests/test_*.py`, `sys.path.insert`, `__main__` 러너).

---

## File Structure

- `backend/utils/pepper.py` — **신규**. 페퍼 로딩(KMS Decrypt + 캐시 + 로컬 폴백)과 `apply_pepper`. 단일 책임: "현재 페퍼를 제공하고 HMAC을 적용한다".
- `backend/handlers/auth_handler.py` — **수정**. 해시 헬퍼를 버전 인식형으로 교체하고 모든 비밀번호/코드 저장·검증 경로를 v2로. login에 투명 마이그레이션 추가.
- `backend/tests/test_password_pepper.py` — **신규**. 로컬 페퍼 + in-memory user store로 KMS 없이 검증.
- `scripts/setup_pepper_kms.py` — **신규(일회성)**. KMS 키 생성·키정책·페퍼 암호화. 관리자 자격으로 1회 실행.

---

### Task 1: `utils/pepper.py` — 페퍼 로딩과 적용

**Files:**
- Create: `backend/utils/pepper.py`
- Test: `backend/tests/test_password_pepper.py` (이 태스크에서는 페퍼 단위 테스트만 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_password_pepper.py` 생성:

```python
import os, sys
os.environ["ENV"] = "local"
os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils import pepper


def test_apply_pepper_is_deterministic_and_hex():
    pepper.reset_cache()
    h1 = pepper.apply_pepper("abc123")
    h2 = pepper.apply_pepper("abc123")
    assert h1 == h2
    assert len(h1) == 64  # HMAC-SHA256 hex
    int(h1, 16)  # hex로 파싱 가능해야 함


def test_apply_pepper_changes_with_pepper():
    os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"
    pepper.reset_cache()
    a = pepper.apply_pepper("abc123")
    os.environ["LOCAL_PEPPER"] = "test-pepper-BBB"
    pepper.reset_cache()
    b = pepper.apply_pepper("abc123")
    os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"  # 원복
    pepper.reset_cache()
    assert a != b  # 페퍼가 실제로 섞여야 함


def test_missing_local_pepper_raises():
    saved = os.environ.pop("LOCAL_PEPPER", None)
    pepper.reset_cache()
    try:
        raised = False
        try:
            pepper.get_pepper()
        except RuntimeError:
            raised = True
        assert raised
    finally:
        if saved is not None:
            os.environ["LOCAL_PEPPER"] = saved
        pepper.reset_cache()


if __name__ == "__main__":
    test_apply_pepper_is_deterministic_and_hex()
    test_apply_pepper_changes_with_pepper()
    test_missing_local_pepper_raises()
    print("OK")
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'utils.pepper'`

- [ ] **Step 3: 최소 구현**

`backend/utils/pepper.py` 생성:

```python
"""
비밀번호 페퍼(server-side pepper) 로딩.
- production: KMS로 암호화된 페퍼(PEPPER_CIPHERTEXT)를 콜드스타트당 1회 Decrypt 후 메모리 캐시.
- local/test: LOCAL_PEPPER 환경변수 평문 사용 (KMS 불필요).
실패 시 예외를 전파하여 인증이 fail-closed 되도록 한다 (무페퍼 우회 금지).
"""
import os
import hmac
import base64
import hashlib

_pepper_cache = None


def reset_cache():
    """테스트용: 캐시 초기화."""
    global _pepper_cache
    _pepper_cache = None


def _load_pepper() -> bytes:
    if os.getenv("ENV", "local") == "local":
        local = os.getenv("LOCAL_PEPPER")
        if not local:
            raise RuntimeError("LOCAL_PEPPER 환경변수가 없습니다 (로컬 페퍼 필요).")
        return local.encode("utf-8")

    ciphertext_b64 = os.getenv("PEPPER_CIPHERTEXT")
    if not ciphertext_b64:
        raise RuntimeError("PEPPER_CIPHERTEXT 환경변수가 없습니다.")
    import boto3
    kms = boto3.client("kms")
    resp = kms.decrypt(CiphertextBlob=base64.b64decode(ciphertext_b64))
    return resp["Plaintext"]


def get_pepper() -> bytes:
    """캐시된 평문 페퍼 반환. 최초 호출 시 로드(KMS Decrypt 또는 로컬 폴백)."""
    global _pepper_cache
    if _pepper_cache is None:
        _pepper_cache = _load_pepper()
    return _pepper_cache


def apply_pepper(pbkdf2_hex: str) -> str:
    """PBKDF2 hex 출력에 HMAC-SHA256(pepper)을 적용한 hex 반환."""
    return hmac.new(get_pepper(), pbkdf2_hex.encode("utf-8"), hashlib.sha256).hexdigest()
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: PASS — `OK` 출력

- [ ] **Step 5: 커밋**

```bash
git add backend/utils/pepper.py backend/tests/test_password_pepper.py
git commit -m "feat(auth): KMS 페퍼 로딩 유틸(utils/pepper) 추가"
```

---

### Task 2: `auth_handler` 해시 헬퍼 버전화 + signup v2 저장

**Files:**
- Modify: `backend/handlers/auth_handler.py` (상단 헬퍼 영역, `signup`)
- Test: `backend/tests/test_password_pepper.py` (추가)

- [ ] **Step 1: 실패하는 테스트 추가**

`backend/tests/test_password_pepper.py`의 import 블록 아래(테스트 함수들 위)에 추가:

```python
from handlers import auth_handler

# in-memory user store로 storage 대체
_STORE = {}
auth_handler.get_user = lambda uid: _STORE.get(uid)
auth_handler.save_user = lambda data: _STORE.__setitem__(data["user_id"], data)


def _reset_store():
    _STORE.clear()
    os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"
    pepper.reset_cache()


def test_signup_stores_v2_hash():
    _reset_store()
    r = auth_handler.signup("홍길동", "a@b.com", "password123")
    assert r["success"] is True
    rec = _STORE["a@b.com"]
    assert rec["hash_version"] == 2
    # 저장된 해시는 PBKDF2-only가 아니라 페퍼 HMAC이 적용돼 있어야 함
    pbkdf2_only = auth_handler._pbkdf2("password123", rec["salt"])
    assert rec["password_hash"] != pbkdf2_only
    assert rec["password_hash"] == auth_handler._secure_hash("password123", rec["salt"])
```

그리고 파일 맨 아래 `__main__` 블록에 호출 추가:

```python
    test_signup_stores_v2_hash()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: FAIL — `AttributeError: module 'handlers.auth_handler' has no attribute '_pbkdf2'`

- [ ] **Step 3: 구현 — 헬퍼 교체와 signup 수정**

`backend/handlers/auth_handler.py`에서:

(a) import에 페퍼 유틸 추가 — 기존 `from utils.storage import get_user, save_user` 아래에:

```python
from utils.pepper import apply_pepper
```

(b) 상단 상수 영역(`PBKDF2_ROUNDS = 100_000` 아래)에 추가:

```python
HASH_VERSION = 2  # v1=PBKDF2만(레거시), v2=PBKDF2+KMS 페퍼
```

(c) 기존 `_hash_pw` 함수를 아래 두 함수로 **교체**:

```python
def _pbkdf2(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
    ).hex()


def _secure_hash(value: str, salt: str) -> str:
    """현재 버전(v2) 해시: PBKDF2 출력에 KMS 페퍼 HMAC을 적용."""
    return apply_pepper(_pbkdf2(value, salt))
```

(d) `signup` 내 저장 부분을 수정 — `save_user({...})`의 `password_hash`/필드를:

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

- [ ] **Step 4: 통과 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: PASS — `OK`

- [ ] **Step 5: 커밋**

```bash
git add backend/handlers/auth_handler.py backend/tests/test_password_pepper.py
git commit -m "feat(auth): signup을 v2(페퍼) 해시로 저장 + 버전화 헬퍼"
```

---

### Task 3: `login` 버전 인식 검증 + 투명 마이그레이션

**Files:**
- Modify: `backend/handlers/auth_handler.py` (`login`, 신규 `_verify` 헬퍼)
- Test: `backend/tests/test_password_pepper.py` (추가)

- [ ] **Step 1: 실패하는 테스트 추가**

테스트 함수 영역에 추가:

```python
def test_login_success_and_reject():
    _reset_store()
    auth_handler.signup("홍길동", "a@b.com", "password123")
    assert auth_handler.login("a@b.com", "password123")["success"] is True
    assert auth_handler.login("a@b.com", "wrongpass1")["success"] is False


def test_v1_user_is_migrated_on_login():
    _reset_store()
    # 페퍼 없이 저장된 레거시(v1) 레코드를 직접 구성
    salt = "deadbeefdeadbeefdeadbeefdeadbeef"
    _STORE["old@b.com"] = {
        "user_id": "old@b.com",
        "email": "old@b.com",
        "name": "구유저",
        "password_hash": auth_handler._pbkdf2("legacy123", salt),  # v1: PBKDF2만
        "salt": salt,
        "auth_type": "email",
        # hash_version 없음 → v1로 간주
    }
    r = auth_handler.login("old@b.com", "legacy123")
    assert r["success"] is True
    rec = _STORE["old@b.com"]
    assert rec["hash_version"] == 2  # 자동 승격됨
    assert rec["password_hash"] == auth_handler._secure_hash("legacy123", rec["salt"])
    # 승격 후에도 동일 비번으로 로그인 가능
    assert auth_handler.login("old@b.com", "legacy123")["success"] is True
    assert auth_handler.login("old@b.com", "legacy123x")["success"] is False
```

`__main__` 블록에 추가:

```python
    test_login_success_and_reject()
    test_v1_user_is_migrated_on_login()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: FAIL — v1 로그인이 거부되거나 `hash_version`이 2로 갱신되지 않아 assert 실패

- [ ] **Step 3: 구현 — `_verify` 추가 및 `login` 교체**

(a) `_secure_hash` 아래에 버전 인식 검증 헬퍼 추가:

```python
def _verify(password: str, user: dict) -> bool:
    """저장된 hash_version에 맞춰 비밀번호를 상수시간 비교."""
    salt = user.get("salt", "")
    stored = user.get("password_hash", "")
    if user.get("hash_version") == HASH_VERSION:
        return secrets.compare_digest(_secure_hash(password, salt), stored)
    # 레거시 v1: PBKDF2만
    return secrets.compare_digest(_pbkdf2(password, salt), stored)
```

(b) `login`의 검증 블록을 교체. 기존:

```python
    if not secrets.compare_digest(_hash_pw(password, user["salt"]), user["password_hash"]):
        return fail

    return {
        "success": True,
        ...
    }
```

을 다음으로:

```python
    if not _verify(password, user):
        return fail

    # 레거시(v1) 유저는 로그인 성공 시 v2로 투명 승격 (멱등; 실패해도 로그인은 유지)
    if user.get("hash_version") != HASH_VERSION:
        try:
            user["password_hash"] = _secure_hash(password, user["salt"])
            user["hash_version"] = HASH_VERSION
            save_user(user)
        except Exception as e:
            print(f"[PEPPER_MIGRATE_WARN] {user.get('user_id')}: {e}")

    return {
        "success": True,
        "user_id": user["user_id"],
        "name": user.get("name", ""),
        "email": email,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: PASS — `OK`

- [ ] **Step 5: 커밋**

```bash
git add backend/handlers/auth_handler.py backend/tests/test_password_pepper.py
git commit -m "feat(auth): login 버전 인식 검증 + v1→v2 투명 마이그레이션"
```

---

### Task 4: `change_password` / 비밀번호 찾기 경로 v2 통일

**Files:**
- Modify: `backend/handlers/auth_handler.py` (`change_password`, `request_reset`, `verify_reset`, `confirm_reset`)
- Test: `backend/tests/test_password_pepper.py` (추가)

- [ ] **Step 1: 실패하는 테스트 추가**

```python
def test_change_password_writes_v2():
    _reset_store()
    auth_handler.signup("홍길동", "a@b.com", "password123")
    r = auth_handler.change_password("a@b.com", "password123", "newpass456")
    assert r["success"] is True
    rec = _STORE["a@b.com"]
    assert rec["hash_version"] == 2
    assert auth_handler.login("a@b.com", "newpass456")["success"] is True
    assert auth_handler.login("a@b.com", "password123")["success"] is False


def test_reset_flow_writes_v2(monkeypatch=None):
    _reset_store()
    auth_handler.signup("홍길동", "a@b.com", "password123")
    # request_reset이 _send_reset_email로 코드를 보냄 → 코드를 가로채기 위해 패치
    captured = {}
    auth_handler._send_reset_email = lambda to, code: captured.update(code=code)
    auth_handler.request_reset("a@b.com")
    code = captured["code"]
    assert auth_handler.verify_reset("a@b.com", code)["success"] is True
    r = auth_handler.confirm_reset("a@b.com", code, "resetpass789")
    assert r["success"] is True
    rec = _STORE["a@b.com"]
    assert rec["hash_version"] == 2
    assert auth_handler.login("a@b.com", "resetpass789")["success"] is True
```

`__main__` 블록에 추가:

```python
    test_change_password_writes_v2()
    test_reset_flow_writes_v2()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: FAIL — `_hash_pw` 가 더 이상 없어 `change_password`/reset 경로에서 `AttributeError` 또는 검증 불일치

- [ ] **Step 3: 구현 — 네 함수의 해시 호출 교체**

`auth_handler.py`에서 남아있는 `_hash_pw` 호출을 모두 버전 헬퍼로 교체한다.

(a) `change_password`:

```python
def change_password(user_id: str, current_password: str, new_password: str) -> dict:
    """비밀번호 변경(이메일 가입자 전용). 현재 비밀번호 검증 후 교체."""
    user = get_user(user_id) if user_id else None
    if not user or user.get("auth_type") != "email":
        return {"success": False, "message": "비밀번호를 변경할 수 없는 계정입니다.", "code": 400}
    if not _verify(current_password or "", user):
        return {"success": False, "message": "현재 비밀번호가 올바르지 않습니다.", "code": 401}
    if len(new_password or "") < 8:
        return {"success": False, "message": "새 비밀번호는 8자 이상이어야 합니다.", "code": 400}
    salt = secrets.token_hex(16)
    user["salt"] = salt
    user["password_hash"] = _secure_hash(new_password, salt)
    user["hash_version"] = HASH_VERSION
    save_user(user)
    return {"success": True, "message": "비밀번호가 변경되었습니다."}
```

(b) `request_reset` 내 코드 저장:

```python
        user["reset_code"] = _secure_hash(code, user["salt"])  # 코드도 페퍼 해시로 저장
```

(c) `verify_reset` 내 코드 비교:

```python
    if not secrets.compare_digest(_secure_hash(code or "", user["salt"]), user["reset_code"]):
        return {"success": False, "message": "인증 코드가 올바르지 않습니다.", "code": 401}
```

(d) `confirm_reset` 내 새 비밀번호 저장:

```python
    user = get_user((email or "").strip().lower())
    salt = secrets.token_hex(16)
    user["salt"] = salt
    user["password_hash"] = _secure_hash(new_password, salt)
    user["hash_version"] = HASH_VERSION
    user.pop("reset_code", None)
    user.pop("reset_expires", None)
    save_user(user)
```

> 주의: `reset_code`는 `request_reset`에서 항상 새로 생성되므로 v1/v2 마이그레이션 이슈가 없다.
> 단, v1 유저가 reset_code(v2 해시)를 저장한 상태에서 `confirm_reset`을 거치면 password_hash도 v2가 되어 일관된다.

이 단계 후 파일 전체에 `_hash_pw` 참조가 남아있지 않아야 한다.

- [ ] **Step 4: 통과 확인**

Run: `cd backend && python tests/test_password_pepper.py`
Expected: PASS — `OK`

추가 확인 — `_hash_pw` 잔재 없음:
Run: `cd backend && python -c "import re,io; s=open('handlers/auth_handler.py',encoding='utf-8').read(); print('LEFTOVER' if '_hash_pw' in s else 'CLEAN')"`
Expected: `CLEAN`

기존 테스트 회귀 없음 확인:
Run: `cd backend && python tests/test_oauth_state.py && python tests/test_slack_sig.py`
Expected: 각각 `OK`

- [ ] **Step 5: 커밋**

```bash
git add backend/handlers/auth_handler.py backend/tests/test_password_pepper.py
git commit -m "feat(auth): change_password/비번찾기 경로를 v2 페퍼 해시로 통일"
```

---

### Task 5: 일회성 KMS 셋업 스크립트

**Files:**
- Create: `scripts/setup_pepper_kms.py`

> 인프라 일회성 스크립트라 단위 테스트 대상이 아니다. 스크립트를 작성하고, **실행은 사용자 확인 후** 진행한다(관리자 자격·실제 KMS 키 생성이 필요하므로).

- [ ] **Step 1: 스크립트 작성**

`scripts/setup_pepper_kms.py` 생성:

```python
#!/usr/bin/env python3
"""
일회성: 비밀번호 페퍼용 KMS 키 생성 + 페퍼 암호화.
관리자 자격증명으로 1회 실행. 출력된 값을 Lambda 환경변수 PEPPER_CIPHERTEXT에 설정.

필요 환경변수:
  LAMBDA_ROLE_ARN  : 페퍼를 복호할 auth Lambda 실행 역할 ARN
  AWS_REGION       : (선택) 기본 ap-northeast-2

검증 포인트: 실행이 성공하면 kms:CreateKey/Encrypt 권한이 boundary에서 허용됨을 의미.
Lambda의 kms:Decrypt는 첫 로그인 시 검증된다.
"""
import os
import sys
import json
import base64
import secrets
import boto3

REGION = os.getenv("AWS_REGION", "ap-northeast-2")
ACCOUNT_ID = "443370697536"
LAMBDA_ROLE_ARN = os.getenv("LAMBDA_ROLE_ARN")


def main():
    if not LAMBDA_ROLE_ARN:
        sys.exit("LAMBDA_ROLE_ARN 환경변수를 설정하세요 (페퍼를 복호할 Lambda 실행 역할 ARN).")

    kms = boto3.client("kms", region_name=REGION)

    key_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AdminRoot",
                "Effect": "Allow",
                "Principal": {"AWS": f"arn:aws:iam::{ACCOUNT_ID}:root"},
                "Action": "kms:*",
                "Resource": "*",
            },
            {
                "Sid": "LambdaDecrypt",
                "Effect": "Allow",
                "Principal": {"AWS": LAMBDA_ROLE_ARN},
                "Action": "kms:Decrypt",
                "Resource": "*",
            },
        ],
    }

    key = kms.create_key(
        Description="LittleBoss password pepper (B2)",
        KeyUsage="ENCRYPT_DECRYPT",
        KeySpec="SYMMETRIC_DEFAULT",
        Policy=json.dumps(key_policy),
    )
    key_id = key["KeyMetadata"]["KeyId"]
    kms.create_alias(AliasName="alias/littleboss-password-pepper", TargetKeyId=key_id)

    pepper = secrets.token_bytes(32)
    enc = kms.encrypt(KeyId=key_id, Plaintext=pepper)
    ciphertext_b64 = base64.b64encode(enc["CiphertextBlob"]).decode("ascii")

    print("KMS KeyId :", key_id)
    print("Alias     : alias/littleboss-password-pepper")
    print()
    print("아래 값을 Lambda 환경변수 PEPPER_CIPHERTEXT 로 설정하세요 (git 커밋 금지):")
    print(ciphertext_b64)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 구문 검증 (자격증명 없이 import만)**

Run: `cd scripts && python -c "import ast; ast.parse(open('setup_pepper_kms.py',encoding='utf-8').read()); print('SYNTAX OK')"`
Expected: `SYNTAX OK`

- [ ] **Step 3: 커밋**

```bash
git add scripts/setup_pepper_kms.py
git commit -m "chore(auth): 페퍼용 KMS 키 셋업 일회성 스크립트"
```

- [ ] **Step 4: (사용자 확인 후 수동 실행) 실제 셋업**

> **에이전트는 여기서 멈추고 사용자에게 보고한다.** 아래는 사용자가 관리자 자격으로 실행할 절차다.
>
> ```bash
> # auth Lambda 실행 역할 ARN을 채워서 실행
> export LAMBDA_ROLE_ARN="arn:aws:iam::443370697536:role/<auth-lambda-role>"
> python scripts/setup_pepper_kms.py
> ```
>
> 1. 출력된 `PEPPER_CIPHERTEXT` 값을 auth Lambda 환경변수에 설정한다(콘솔/CLI). **git 커밋 금지.**
> 2. `kms:CreateKey`/`Encrypt`가 막히면(boundary) 즉시 중단하고 보고 — 이 경우 KMS 권한 조정이 선행돼야 한다.
> 3. 배포 후 신규 가입 1건으로 로그인 검증 → 첫 로그인에서 `kms:Decrypt` 권한이 확인된다.

---

## Self-Review

**1. Spec coverage**
- 핵심 메커니즘(PBKDF2+페퍼 HMAC) → Task 1(apply_pepper) + Task 2(_secure_hash). ✓
- 페퍼 로딩(콜드스타트 1회 Decrypt, 로컬 폴백, fail-closed) → Task 1. ✓
- 데이터 모델 `hash_version` → Task 2/3/4에서 저장. ✓
- auth_handler 전 경로 v2화(signup/login/change_password/reset) → Task 2~4. ✓
- 투명 마이그레이션 → Task 3. ✓
- reset_code 동일 함수 통일 → Task 4. ✓
- 상수시간 비교 유지 → `_verify`/`compare_digest` (Task 3, 4). ✓
- KMS 키 정책으로 Decrypt 부여 + 셋업 스크립트 → Task 5. ✓
- 테스트(로컬 페퍼, v1→v2 승격, 페퍼 실제 적용, change/reset v2) → Task 1~4 테스트. ✓
- 리스크(boundary 권한 확인) → Task 5 Step 4. ✓

**2. Placeholder scan:** 모든 코드 단계에 실제 코드 포함, TBD/TODO 없음. ✓

**3. Type consistency:** `_pbkdf2`, `_secure_hash`, `_verify`, `apply_pepper`, `get_pepper`, `reset_cache`, `HASH_VERSION` 이름이 정의(Task 1·2·3)와 사용(Task 2·3·4 테스트·구현) 전반에서 일치. `_hash_pw`는 Task 2에서 완전 제거되고 Task 4 Step 4에서 잔재 없음 검증. ✓
