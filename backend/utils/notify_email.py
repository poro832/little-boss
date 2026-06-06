"""
문서 완료 이메일 알림 (SNS).
SES가 IAM 차단이라 SNS 단일 토픽 + user_id 필터 정책으로 개인 타겟.
- subscribe_user: 가입/로그인 시 1회, 이메일을 토픽에 구독(FilterPolicy=user_id).
- notify_done: 분석 완료 시 해당 user_id에게만 Publish.
전부 best-effort: 실패해도 호출부(가입/분석)는 안 깨진다.
ENV=local 또는 USER_NOTIFY_TOPIC_ARN 미설정이면 no-op(False).
"""
import os
import json
from utils.storage import get_user

# SNS Subject는 ASCII만 허용(≤100자, 줄바꿈/제어문자 불가) — 한글 내용은 본문에만.
_SUBJECT = "LittleBoss - document analysis complete"


def _topic_arn():
    return os.getenv("USER_NOTIFY_TOPIC_ARN")


def subscribe_user(email: str, user_id: str) -> bool:
    """이메일을 알림 토픽에 구독(FilterPolicy=user_id). 성공 시 True, 아니면 False(no-op 포함)."""
    arn = _topic_arn()
    if os.getenv("ENV", "local") == "local" or not arn or not email or not user_id:
        return False
    try:
        import boto3
        boto3.client("sns").subscribe(
            TopicArn=arn,
            Protocol="email",
            Endpoint=email,
            Attributes={"FilterPolicy": json.dumps({"user_id": [str(user_id)]})},
            ReturnSubscriptionArn=True,
        )
        return True  # SNS가 요청 수락 — 유저가 확인메일 클릭 전엔 실제 발송은 안 됨
    except Exception as e:
        print(f"[NOTIFY_SUBSCRIBE_ERROR] {email}: {e}")
        return False


def _build_message(doc: dict) -> str:
    a = doc.get("analysis", {}) or {}
    doc_type = a.get("document_type", "문서")
    lines = [f"'{doc_type}' 문서 분석이 완료되었습니다.", ""]
    dls = a.get("deadlines", []) or []
    if dls:
        lines.append("[마감 일정]")
        for d in dls:
            lines.append(f"- {d.get('date', '')} {d.get('description', '')}".rstrip())
        lines.append("")
    reqs = a.get("required_documents", []) or []
    if reqs:
        lines.append("[필요 서류]")
        for r in reqs:
            lines.append(f"- {r.get('name', '')}")
        lines.append("")
    lines.append("LittleBoss 앱에서 자세한 내용을 확인하세요.")
    return "\n".join(lines)


def notify_done(doc: dict) -> bool:
    """문서 분석 완료 시 해당 user_id에게만 알림 Publish. 발행 시 True, 아니면 False."""
    arn = _topic_arn()
    if os.getenv("ENV", "local") == "local" or not arn or not doc:
        return False
    user_id = doc.get("user_id", "")
    if not user_id:
        return False
    try:
        u = get_user(user_id)
        if u and (u.get("notif_settings") or {}).get("mail", True) is False:
            return False
        import boto3
        boto3.client("sns").publish(
            TopicArn=arn,
            Subject=_SUBJECT,
            Message=_build_message(doc),
            MessageAttributes={"user_id": {"DataType": "String", "StringValue": str(user_id)}},
        )
        return True
    except Exception as e:
        print(f"[EMAIL_NOTIFY_ERROR] {doc.get('doc_id')}: {e}")
        return False
