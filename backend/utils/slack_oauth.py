"""OAuth state HMAC 서명/검증 + Google 토큰 교환 (stdlib만 사용)."""
import hmac
import hashlib
import time
import json
import base64
import urllib.request
import urllib.parse
import os
import urllib.error


class TokenExpiredError(Exception):
    """Google refresh token 만료/철회 (invalid_grant)."""
    pass


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
    try:
        resp = urllib.request.urlopen(
            urllib.request.Request("https://oauth2.googleapis.com/token", data=data))
        return json.loads(resp.read())["access_token"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        if e.code == 400 and "invalid_grant" in body:
            raise TokenExpiredError(body)
        raise


def email_from_id_token(id_token: str) -> str:
    """id_token(JWT) payload에서 email 추출 (검증은 Google 교환에서 이미 수행됨)."""
    return json.loads(_b64d(id_token.split(".")[1])).get("email", "")


def build_connect_url(slack_user: str, channel: str, thread_ts: str) -> str:
    """Slack 사용자용 Google 캘린더 연동 OAuth URL (서명된 state 포함)."""
    state = sign_state(os.environ["SLACK_SIGNING_SECRET"], slack_user, channel, thread_ts)
    redirect = f"{os.environ['API_BASE']}/slack/google/callback"
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": redirect,
        "response_type": "code", "scope": "https://www.googleapis.com/auth/calendar.events email",
        "access_type": "offline", "prompt": "consent", "state": state})
