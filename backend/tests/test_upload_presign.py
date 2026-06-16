import os, sys, json
os.environ["ENV"] = "local"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from handlers import upload_handler

_saved = {}
upload_handler.save_document = lambda doc_id, data: _saved.__setitem__(doc_id, data)
upload_handler.presigned_put_url = lambda key, **k: f"https://s3.example/{key}?sig=abc"


def _post_upload(body):
    return upload_handler.handle({"path": "/upload", "httpMethod": "POST", "body": json.dumps(body)})


def test_presign_returns_url_and_saves_record():
    _saved.clear()
    resp = _post_upload({"filename": "scholarship.pdf", "user_id": "u@e.com"})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert body["doc_id"]
    key = f"uploads/{body['doc_id']}/scholarship.pdf"
    assert body["upload_url"] == f"https://s3.example/{key}?sig=abc"
    rec = _saved[body["doc_id"]]
    assert rec["status"] == "uploaded"
    assert rec["file_path"] == key
    assert rec["user_id"] == "u@e.com"
    assert rec["filename"] == "scholarship.pdf"


def test_presign_rejects_bad_extension():
    _saved.clear()
    resp = _post_upload({"filename": "malware.exe", "user_id": "u"})
    assert resp["statusCode"] == 400
    assert json.loads(resp["body"])["success"] is False
    assert _saved == {}


def test_presign_requires_filename():
    _saved.clear()
    resp = _post_upload({"user_id": "u"})
    assert resp["statusCode"] == 400
    assert json.loads(resp["body"])["success"] is False


if __name__ == "__main__":
    test_presign_returns_url_and_saves_record()
    test_presign_rejects_bad_extension()
    test_presign_requires_filename()
    print("OK")
