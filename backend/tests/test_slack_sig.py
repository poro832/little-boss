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

def test_bad_timestamp():
    assert verify_signature(SECRET, '{}', "notanumber", "v0=x") is False

if __name__ == "__main__":
    test_valid(); test_tampered_body(); test_expired(); test_bad_timestamp(); print("OK")
