"""GET /slack/google/callback — Google OAuth 콜백.

code→토큰 교환 → refresh token 저장(slack_links.save_link) → Slack 스레드에 연결완료 답글.
"""
import os
from utils.slack_oauth import verify_state, exchange_code, email_from_id_token
from utils.slack_links import save_link
from utils.slack import post_message


def _html(msg):
    return {"statusCode": 200, "headers": {"Content-Type": "text/html; charset=utf-8"},
            "body": f"<html><body style='font-family:sans-serif;text-align:center;padding:48px'>{msg}<br><br>이 창을 닫아도 됩니다.</body></html>"}


def handle(event, context=None):
    q = event.get("queryStringParameters") or {}
    secret = os.environ["SLACK_SIGNING_SECRET"]
    ok, st = verify_state(secret, q.get("state", ""))
    if not ok:
        return _html("⚠️ 잘못되었거나 만료된 요청입니다. Slack에서 다시 시도해주세요.")
    rc = event.get("requestContext", {})
    redirect_uri = f"https://{rc.get('domainName')}/{rc.get('stage')}/slack/google/callback"
    tok = exchange_code(os.environ["GOOGLE_CLIENT_ID"], os.environ["GOOGLE_CLIENT_SECRET"], redirect_uri, q.get("code"))
    if "refresh_token" not in tok:
        return _html("⚠️ 연결 실패: 이미 연결된 계정이면 Google 계정 권한 페이지에서 앱 접근을 제거한 뒤 다시 시도해주세요.")
    email = email_from_id_token(tok.get("id_token", "")) or "(이메일 미상)"
    save_link(st["slack_user_id"], email, tok["refresh_token"])
    try:
        post_message(os.environ["SLACK_BOT_TOKEN"], st["channel"], st["thread_ts"],
                     f"✅ Google 계정({email}) 연결 완료! 이제 올리는 문서의 일정이 캘린더에 자동 등록됩니다.")
    except Exception as e:
        print(f"[SLACK_POST_ERROR] {e}")
    return _html(f"✅ {email} 연결 완료! 이제 Slack에 문서를 올리면 일정이 자동 등록됩니다.")
