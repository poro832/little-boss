"""Slack 연결·멱등 저장 — 신규 테이블 없이 기존 users 테이블 재사용.

키 규칙(users 테이블):
- "slack#<slack_user_id>"  → {email}            (Slack→이메일 매핑)
- "<email>"               → {..., google_refresh_token}  (개인 캘린더 등록용)
- "evt#<event_id>"        → 멱등 마커(조건부 put)
"""
import os
from utils.storage import get_user, save_user, delete_user

ENV = os.getenv("ENV", "local")
_local_events = set()


def mark_event_seen(event_id: str) -> bool:
    """처음 보는 이벤트면 True(기록), 중복이면 False. Slack 재시도로 인한 중복 처리 방지."""
    key = f"evt#{event_id}"
    if ENV == "local":
        if key in _local_events:
            return False
        _local_events.add(key)
        return True
    import time
    import boto3
    from botocore.exceptions import ClientError
    table = boto3.resource("dynamodb").Table(os.getenv("USERS_TABLE", "sgu-pj-03-users"))
    try:
        table.put_item(
            Item={"user_id": key, "ttl": int(time.time()) + 86400},
            ConditionExpression="attribute_not_exists(user_id)",
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def save_link(slack_user_id: str, email: str, refresh_token: str):
    """Slack↔Google 연결 저장: 매핑 항목 + 이메일 사용자에 refresh_token."""
    save_user({"user_id": f"slack#{slack_user_id}", "email": email, "auth_type": "slack_link"})
    user = get_user(email) or {"user_id": email, "email": email, "auth_type": "google"}
    user["google_refresh_token"] = refresh_token
    save_user(user)


def get_email_for_slack(slack_user_id: str):
    """연결된 이메일 또는 None."""
    u = get_user(f"slack#{slack_user_id}")
    return u.get("email") if u else None


def get_refresh_token(email: str):
    """이메일 사용자의 Google refresh token 또는 None."""
    u = get_user(email)
    return u.get("google_refresh_token") if u else None


def delete_link(slack_user_id: str):
    """연결 해제: 이메일 사용자의 토큰 제거 + 매핑 항목 삭제 (토큰 만료/철회 시)."""
    email = get_email_for_slack(slack_user_id)
    if email:
        u = get_user(email)
        if u and u.pop("google_refresh_token", None) is not None:
            save_user(u)
    delete_user(f"slack#{slack_user_id}")
