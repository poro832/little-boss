"""
이메일/비밀번호 인증 핸들러
- 비밀번호: hashlib.pbkdf2_hmac (stdlib, 외부 의존성 0)
- 이메일 가입자는 user_id = 이메일 (구글 가입자는 Google sub → 충돌 없음)
- 구글 로그인과 동일 모델: 백엔드 토큰 검증 없음, 프론트가 user_id 보관
"""
import re
import hashlib
import secrets
from datetime import datetime, timezone
from utils.storage import get_user, save_user

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PBKDF2_ROUNDS = 100_000


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
