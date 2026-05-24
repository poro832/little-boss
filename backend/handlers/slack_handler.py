"""POST /slack/events — Slack 이벤트 진입점.

서명검증 → challenge/멱등 → 파일 다운로드 → 기존 process()로 ingest → 즉시 ack.
무거운 분석은 기존 S3 트리거 파이프라인이 비동기로 처리하고, 완료 알림·캘린더는
action_handler.notify_slack_done 이 담당한다. 미연결 사용자에겐 Google 연결 링크 안내.
"""
import os
import json
import urllib.parse
from utils.slack import verify_signature, get_file_info, download_file, post_message
from utils.slack_links import mark_event_seen, get_email_for_slack
from utils.slack_oauth import sign_state


def _resp(code, body="ok"):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": body if isinstance(body, str) else json.dumps(body)}


def handle(event, context=None):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    raw = event.get("body") or ""
    secret = os.environ["SLACK_SIGNING_SECRET"]
    if not verify_signature(secret, raw, headers.get("x-slack-request-timestamp", ""), headers.get("x-slack-signature", "")):
        return _resp(401, "bad signature")
    payload = json.loads(raw or "{}")
    if payload.get("type") == "url_verification":          # Slack URL 등록 챌린지
        return _resp(200, payload.get("challenge", ""))
    ev = payload.get("event", {})
    if ev.get("type") == "file_shared":
        event_id = payload.get("event_id", ev.get("file_id", ""))
        if mark_event_seen(event_id):                      # 중복(재시도) 아니면 처리
            try:
                _ingest(ev)
            except Exception as e:
                print(f"[SLACK_INGEST_ERROR] {e}")
    return _resp(200, "ok")                                # 3초 내 즉시 ack


def _ingest(ev):
    from handlers.upload_handler import process
    token = os.environ["SLACK_BOT_TOKEN"]
    slack_user, channel, ts = ev.get("user_id"), ev.get("channel_id"), ev.get("event_ts")
    info = get_file_info(token, ev.get("file_id"))
    filename = info.get("name", "slack_file")
    data = download_file(token, info["url_private_download"])
    email = get_email_for_slack(slack_user)
    user_id = email or f"slack:{slack_user}"
    result = process(filename, data, user_id, extra={
        "source": "slack", "slack_channel": channel, "slack_thread_ts": ts})
    if not result.get("success"):
        post_message(token, channel, ts, f"⚠️ 처리 실패: {result.get('message')}")
        return
    if not email:
        state = sign_state(os.environ["SLACK_SIGNING_SECRET"], slack_user, channel, ts)
        redirect = f"{os.environ['API_BASE']}/slack/google/callback"
        auth = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
            "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": redirect,
            "response_type": "code", "scope": "https://www.googleapis.com/auth/calendar.events email",
            "access_type": "offline", "prompt": "consent", "state": state})
        post_message(token, channel, ts,
                     f"📎 문서 분석을 시작했어요. 일정을 *개인 Google 캘린더*에 자동 등록하려면 계정을 연결하세요:\n{auth}")
    else:
        post_message(token, channel, ts, "📎 문서 분석을 시작했어요. 완료되면 결과를 여기에 올릴게요.")
