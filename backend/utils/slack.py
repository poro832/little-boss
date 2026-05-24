"""Slack Web API + 요청 서명 검증 (stdlib만 사용, 외부 의존성 0)."""
import hmac
import hashlib
import time
import json
import urllib.request
import urllib.parse


def verify_signature(signing_secret: str, raw_body: str, timestamp: str, slack_sig: str, max_skew: int = 300) -> bool:
    """X-Slack-Signature 검증: timestamp 5분 윈도우 + HMAC-SHA256 상수시간 비교."""
    try:
        if abs(time.time() - int(timestamp)) > max_skew:
            return False
    except (TypeError, ValueError):
        return False
    base = f"v0:{timestamp}:{raw_body}".encode()
    expected = "v0=" + hmac.new(signing_secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, slack_sig or "")


def _api(method: str, token: str, params: dict) -> dict:
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        f"https://slack.com/api/{method}", data=data,
        headers={"Authorization": f"Bearer {token}"},
    )
    return json.loads(urllib.request.urlopen(req).read().decode())


def get_file_info(token: str, file_id: str) -> dict:
    r = _api("files.info", token, {"file": file_id})
    if not r.get("ok"):
        raise RuntimeError(f"files.info 실패: {r.get('error')}")
    return r["file"]


def download_file(token: str, url_private_download: str) -> bytes:
    req = urllib.request.Request(url_private_download, headers={"Authorization": f"Bearer {token}"})
    return urllib.request.urlopen(req).read()


def post_message(token: str, channel: str, thread_ts: str, text: str, blocks=None) -> dict:
    payload = {"channel": channel, "thread_ts": thread_ts, "text": text}
    if blocks:
        payload["blocks"] = json.dumps(blocks)
    return _api("chat.postMessage", token, payload)
