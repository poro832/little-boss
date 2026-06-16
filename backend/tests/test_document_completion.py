import os, sys, json
os.environ["ENV"] = "local"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from handlers import action_handler

_store = {}
action_handler.get_document = lambda doc_id: _store.get(doc_id)
action_handler.save_document = lambda doc_id, data: _store.__setitem__(doc_id, data)


def _patch(doc_id, body):
    return action_handler.handle({
        "path": f"/checklist/{doc_id}", "httpMethod": "PATCH",
        "pathParameters": {"doc_id": doc_id}, "body": json.dumps(body),
    })


def test_set_completed_true():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done", "completed": False}
    resp = _patch("d1", {"set_completed": True})
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 200
    assert body["success"] is True
    assert body["completed"] is True
    assert _store["d1"]["completed"] is True
    assert _store["d1"].get("completed_at")  # 완료 시각 기록


def test_set_completed_false_removes_timestamp():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done", "completed": True, "completed_at": "2026-06-16T00:00:00"}
    resp = _patch("d1", {"set_completed": False})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert _store["d1"]["completed"] is False
    assert "completed_at" not in _store["d1"]


def test_completion_doc_not_found():
    _store.clear()
    resp = _patch("missing", {"set_completed": True})
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 400
    assert body["success"] is False


def test_checklist_item_toggle_still_works():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done",
                    "checklist": [{"name": "성적증명서", "description": "", "completed": False}]}
    resp = _patch("d1", {"name": "성적증명서", "completed": True})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert _store["d1"]["checklist"][0]["completed"] is True


if __name__ == "__main__":
    test_set_completed_true()
    test_set_completed_false_removes_timestamp()
    test_completion_doc_not_found()
    test_checklist_item_toggle_still_works()
    print("OK")
