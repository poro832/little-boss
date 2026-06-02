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
