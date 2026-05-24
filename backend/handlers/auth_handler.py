"""
이메일/비밀번호 인증 핸들러
- 비밀번호: hashlib.pbkdf2_hmac (stdlib, 외부 의존성 0)
- 이메일 가입자는 user_id = 이메일 (구글 가입자는 Google sub → 충돌 없음)
- 구글 로그인과 동일 모델: 백엔드 토큰 검증 없음, 프론트가 user_id 보관
"""
import os
import re
import time
import hashlib
import secrets
from datetime import datetime, timezone
from utils.storage import get_user, save_user

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PBKDF2_ROUNDS = 100_000
RESET_CODE_TTL = 600  # 인증 코드 유효시간(초) = 10분


def _hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
    ).hex()


def signup(name: str, email: str, password: str) -> dict:
    """회원가입. 반환: {success, user_id, name, email} 또는 {success:False, message, code}"""
    name = (name or "").strip()
    email = (email or "").strip().lower()
    password = password or ""

    if not name or not email or not password:
        return {"success": False, "message": "이름·이메일·비밀번호를 모두 입력해주세요.", "code": 400}
    if not EMAIL_RE.match(email):
        return {"success": False, "message": "이메일 형식이 올바르지 않습니다.", "code": 400}
    if len(password) < 8:
        return {"success": False, "message": "비밀번호는 8자 이상이어야 합니다.", "code": 400}
    if get_user(email):
        return {"success": False, "message": "이미 가입된 이메일입니다.", "code": 409}

    salt = secrets.token_hex(16)
    save_user({
        "user_id": email,
        "email": email,
        "name": name,
        "password_hash": _hash_pw(password, salt),
        "salt": salt,
        "auth_type": "email",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "user_id": email, "name": name, "email": email}


def login(email: str, password: str) -> dict:
    """로그인. 반환: {success, user_id, name, email} 또는 {success:False, message, code}"""
    email = (email or "").strip().lower()
    password = password or ""

    if not email or not password:
        return {"success": False, "message": "이메일·비밀번호를 입력해주세요.", "code": 400}

    user = get_user(email)
    # 보안상 "이메일 없음"과 "비번 틀림"을 같은 메시지로 통일
    fail = {"success": False, "message": "이메일 또는 비밀번호가 올바르지 않습니다.", "code": 401}
    if not user or user.get("auth_type") != "email":
        return fail
    if not secrets.compare_digest(_hash_pw(password, user["salt"]), user["password_hash"]):
        return fail

    return {
        "success": True,
        "user_id": user["user_id"],
        "name": user.get("name", ""),
        "email": email,
    }


# ── 프로필/계정 관리 ──────────────────────────────────────

def _load_or_init(user_id: str) -> dict:
    """기존 사용자 조회, 없으면 최소 레코드 생성(구글 로그인 사용자 대응)."""
    return get_user(user_id) or {
        "user_id": user_id,
        "auth_type": "google",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def update_profile(user_id: str, name=None, affiliation=None) -> dict:
    """프로필(이름·소속) 수정. 이메일=user_id는 키이므로 변경 불가."""
    if not user_id:
        return {"success": False, "message": "사용자 정보가 없습니다.", "code": 400}
    user = _load_or_init(user_id)
    if name is not None:
        if not name.strip():
            return {"success": False, "message": "이름을 입력해주세요.", "code": 400}
        user["name"] = name.strip()
    if affiliation is not None:
        user["affiliation"] = affiliation.strip()
    save_user(user)
    return {"success": True, "user_id": user_id, "name": user.get("name", ""),
            "affiliation": user.get("affiliation", "")}


def change_password(user_id: str, current_password: str, new_password: str) -> dict:
    """비밀번호 변경(이메일 가입자 전용). 현재 비밀번호 검증 후 교체."""
    user = get_user(user_id) if user_id else None
    if not user or user.get("auth_type") != "email":
        return {"success": False, "message": "비밀번호를 변경할 수 없는 계정입니다.", "code": 400}
    if not secrets.compare_digest(_hash_pw(current_password or "", user["salt"]), user["password_hash"]):
        return {"success": False, "message": "현재 비밀번호가 올바르지 않습니다.", "code": 401}
    if len(new_password or "") < 8:
        return {"success": False, "message": "새 비밀번호는 8자 이상이어야 합니다.", "code": 400}
    salt = secrets.token_hex(16)
    user["salt"] = salt
    user["password_hash"] = _hash_pw(new_password, salt)
    save_user(user)
    return {"success": True, "message": "비밀번호가 변경되었습니다."}


def update_notif_settings(user_id: str, settings: dict) -> dict:
    """알림 설정(토글 맵) 저장."""
    if not user_id:
        return {"success": False, "message": "사용자 정보가 없습니다.", "code": 400}
    user = _load_or_init(user_id)
    user["notif_settings"] = settings or {}
    save_user(user)
    return {"success": True, "notif_settings": user["notif_settings"]}


def delete_account(user_id: str) -> dict:
    """회원 탈퇴: 보유 문서 전부 삭제 후 사용자 레코드 삭제."""
    if not user_id:
        return {"success": False, "message": "사용자 정보가 없습니다.", "code": 400}
    from utils.storage import list_documents, delete_document, delete_user
    try:
        for d in list_documents(user_id):
            try:
                delete_document(d["doc_id"])
            except Exception as e:
                print(f"문서 삭제 경고({d.get('doc_id')}): {e}")
        delete_user(user_id)
        return {"success": True, "message": "회원 탈퇴가 완료되었습니다."}
    except Exception as e:
        return {"success": False, "message": f"탈퇴 처리 실패: {e}", "code": 500}


# ── 비밀번호 찾기 (이메일 인증 코드, AWS SES) ───────────────

def _send_reset_email(to_email: str, code: str):
    """SES로 인증 코드 발송. SES_SENDER 미설정/로컬이면 로그로 대체."""
    sender = os.getenv("SES_SENDER")
    if not sender or os.getenv("ENV") == "local":
        # SES 미설정 폴백: CloudWatch 로그로 코드 출력 (ASCII 마커로 필터링 용이)
        print(f"[LITTLEBOSS_RESET_CODE] {to_email} {code}")
        return
    import boto3
    boto3.client("ses").send_email(
        Source=sender,
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": "[LittleBoss] 비밀번호 재설정 인증 코드", "Charset": "UTF-8"},
            "Body": {"Text": {"Data": f"인증 코드: {code}\n\n10분 안에 입력해주세요. 본인이 요청하지 않았다면 무시하세요.", "Charset": "UTF-8"}},
        },
    )


def request_reset(email: str) -> dict:
    """재설정 코드 요청. 가입 여부 노출 방지를 위해 응답은 항상 동일."""
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        return {"success": False, "message": "이메일 형식이 올바르지 않습니다.", "code": 400}
    user = get_user(email)
    if user and user.get("auth_type") == "email":
        code = f"{secrets.randbelow(1_000_000):06d}"
        user["reset_code"] = _hash_pw(code, user["salt"])  # 코드도 해시로 저장
        user["reset_expires"] = int(time.time()) + RESET_CODE_TTL
        save_user(user)
        _send_reset_email(email, code)
    return {"success": True, "message": "가입된 이메일이라면 인증 코드를 발송했습니다."}


def verify_reset(email: str, code: str) -> dict:
    """인증 코드 검증(만료·일치)."""
    email = (email or "").strip().lower()
    user = get_user(email)
    if not user or not user.get("reset_code") or not user.get("reset_expires"):
        return {"success": False, "message": "인증 코드를 먼저 요청해주세요.", "code": 400}
    if int(time.time()) > int(user["reset_expires"]):
        return {"success": False, "message": "인증 코드가 만료되었습니다. 다시 요청해주세요.", "code": 400}
    if not secrets.compare_digest(_hash_pw(code or "", user["salt"]), user["reset_code"]):
        return {"success": False, "message": "인증 코드가 올바르지 않습니다.", "code": 401}
    return {"success": True, "message": "인증되었습니다."}


def confirm_reset(email: str, code: str, new_password: str) -> dict:
    """코드 재검증 후 새 비밀번호로 교체, 코드 무효화."""
    v = verify_reset(email, code)
    if not v.get("success"):
        return v
    if len(new_password or "") < 8:
        return {"success": False, "message": "새 비밀번호는 8자 이상이어야 합니다.", "code": 400}
    user = get_user((email or "").strip().lower())
    salt = secrets.token_hex(16)
    user["salt"] = salt
    user["password_hash"] = _hash_pw(new_password, salt)
    user.pop("reset_code", None)
    user.pop("reset_expires", None)
    save_user(user)
    return {"success": True, "message": "비밀번호가 재설정되었습니다."}
