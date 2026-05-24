import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["ENV"] = "local"
from utils.slack_links import mark_event_seen, save_link, get_email_for_slack, get_refresh_token, delete_link
from utils.storage import delete_user

def test_dedup():
    assert mark_event_seen("e1") is True
    assert mark_event_seen("e1") is False     # 중복
    assert mark_event_seen("e2") is True

def test_link_roundtrip():
    save_link("U9", "tester_slack@example.com", "rt-xyz")
    assert get_email_for_slack("U9") == "tester_slack@example.com"
    assert get_refresh_token("tester_slack@example.com") == "rt-xyz"
    delete_link("U9")
    assert get_email_for_slack("U9") is None
    assert get_refresh_token("tester_slack@example.com") is None
    delete_user("tester_slack@example.com")   # 테스트 정리

if __name__ == "__main__":
    test_dedup(); test_link_roundtrip(); print("OK")
