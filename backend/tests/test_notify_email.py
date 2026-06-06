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
