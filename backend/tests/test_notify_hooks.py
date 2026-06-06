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
    assert called["n"] == 0


if __name__ == "__main__":
    test_signup_subscribes_and_flags()
    test_login_lazy_subscribe_existing_user()
    test_login_skips_subscribe_when_already_flagged()
    print("OK")
