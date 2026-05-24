import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.slack_oauth import sign_state, verify_state

SECRET = "statesecret"

def test_roundtrip():
    s = sign_state(SECRET, "U123", "C1", "169.7")
    ok, data = verify_state(SECRET, s)
    assert ok and data["slack_user_id"] == "U123" and data["channel"] == "C1" and data["thread_ts"] == "169.7"

def test_tampered():
    s = sign_state(SECRET, "U123", "C1", "169.7")
    bad = s[:-2] + ("00" if not s.endswith("00") else "11")
    ok, _ = verify_state(SECRET, bad)
    assert ok is False

def test_wrong_secret():
    s = sign_state(SECRET, "U123", "C1", "169.7")
    ok, _ = verify_state("othersecret", s)
    assert ok is False

def test_expired():
    s = sign_state(SECRET, "U123", "C1", "169.7", issued_at=0)
    ok, _ = verify_state(SECRET, s, max_age=60)
    assert ok is False

if __name__ == "__main__":
    test_roundtrip(); test_tampered(); test_wrong_secret(); test_expired(); print("OK")
