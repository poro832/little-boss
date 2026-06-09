import os, sys, io, json
import urllib.error
os.environ.setdefault("SLACK_SIGNING_SECRET", "testsecret")
os.environ.setdefault("API_BASE", "https://api.example.com/prod")
os.environ.setdefault("GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils import slack_oauth
from utils.slack_oauth import build_connect_url, refresh_access_token, TokenExpiredError, verify_state


def test_build_connect_url_contains_params_and_valid_state():
    url = build_connect_url("U123", "C1", "169.7")
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=client-123" in url
    assert "%2Fslack%2Fgoogle%2Fcallback" in url  # redirect_uri 인코딩됨
    from urllib.parse import parse_qs, urlparse
    state = parse_qs(urlparse(url).query)["state"][0]
    ok, data = verify_state("testsecret", state)
    assert ok and data["slack_user_id"] == "U123" and data["channel"] == "C1" and data["thread_ts"] == "169.7"


def _fake_http_error(code, body):
    return urllib.error.HTTPError("https://oauth2.googleapis.com/token", code, "err", {}, io.BytesIO(body.encode()))


def test_refresh_access_token_raises_token_expired_on_invalid_grant():
    slack_oauth.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(_fake_http_error(400, json.dumps({"error": "invalid_grant"})))
    raised = False
    try:
        refresh_access_token("cid", "secret", "dead-token")
    except TokenExpiredError:
        raised = True
    assert raised


def test_refresh_access_token_reraises_other_errors():
    slack_oauth.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(_fake_http_error(500, "server error"))
    got_expired = False
    got_other = False
    try:
        refresh_access_token("cid", "secret", "tok")
    except TokenExpiredError:
        got_expired = True
    except Exception:
        got_other = True
    assert got_other and not got_expired


if __name__ == "__main__":
    test_build_connect_url_contains_params_and_valid_state()
    test_refresh_access_token_raises_token_expired_on_invalid_grant()
    test_refresh_access_token_reraises_other_errors()
    print("OK")
