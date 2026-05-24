"""OAuth state HMAC 서명/검증 + Google 토큰 교환 (stdlib만 사용)."""
import hmac
import hashlib
import time
import json
import base64
import urllib.request
import urllib.parse


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_state(secret: str, slack_user_id: str, channel: str, thread_ts: str, issued_at: int = None) -> str:
    """연결 위조 방지용 서명된 state. body.sig 형태."""
    payload = {"slack_user_id": slack_user_id, "channel": channel, "thread_ts": thread_ts,
               "iat": issued_at if issued_at is not None else int(time.time())}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64e(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_state(secret: str, state: str, max_age: int = 600):
    """(ok: bool, data: dict|None). 서명·만료 검증."""
    try:
        body, sig = state.split(".", 1)
        expected = _b64e(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig):
            return False, None
        data = json.loads(_b64d(body))
        if int(time.time()) - int(data["iat"]) > max_age:
            return False, None
        return True, data
    except Exception:
        return False, None


def exchange_code(client_id, client_secret, redirect_uri, code) -> dict:
    """authorization code → {access_token, refresh_token, id_token, ...}"""
    data = urllib.parse.urlencode({
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    }).encode()
    return json.loads(urllib.request.urlopen(
        urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())


def refresh_access_token(client_id, client_secret, refresh_token) -> str:
    data = urllib.parse.urlencode({
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh_token, "grant_type": "refresh_token",
    }).encode()
    return json.loads(urllib.request.urlopen(
        urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())["access_token"]


def email_from_id_token(id_token: str) -> str:
    """id_token(JWT) payload에서 email 추출 (검증은 Google 교환에서 이미 수행됨)."""
    return json.loads(_b64d(id_token.split(".")[1])).get("email", "")
