import os, sys
os.environ["ENV"] = "local"
os.environ["LOCAL_PEPPER"] = "test-pepper-AAA"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils import pepper
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


if __name__ == "__main__":
    test_signup_stores_v2_hash()
    test_apply_pepper_is_deterministic_and_hex()
    test_apply_pepper_changes_with_pepper()
    test_missing_local_pepper_raises()
    test_login_success_and_reject()
    test_v1_user_is_migrated_on_login()
    print("OK")
