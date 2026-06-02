"""
비밀번호 페퍼(server-side pepper) 로딩.
- production: KMS로 암호화된 페퍼(PEPPER_CIPHERTEXT)를 콜드스타트당 1회 Decrypt 후 메모리 캐시.
- local/test: LOCAL_PEPPER 환경변수 평문 사용 (KMS 불필요).
실패 시 예외를 전파하여 인증이 fail-closed 되도록 한다 (무페퍼 우회 금지).
"""
import os
import hmac
import base64
import hashlib

_pepper_cache = None


def reset_cache():
    """테스트용: 캐시 초기화."""
    global _pepper_cache
    _pepper_cache = None


def _load_pepper() -> bytes:
    if os.getenv("ENV", "local") == "local":
        local = os.getenv("LOCAL_PEPPER")
        if not local:
            raise RuntimeError("LOCAL_PEPPER 환경변수가 없습니다 (로컬 페퍼 필요).")
        return local.encode("utf-8")

    ciphertext_b64 = os.getenv("PEPPER_CIPHERTEXT")
    if not ciphertext_b64:
        raise RuntimeError("PEPPER_CIPHERTEXT 환경변수가 없습니다.")
    import boto3
    kms = boto3.client("kms")
    resp = kms.decrypt(CiphertextBlob=base64.b64decode(ciphertext_b64))
    return resp["Plaintext"]


def get_pepper() -> bytes:
    """캐시된 평문 페퍼 반환. 최초 호출 시 로드(KMS Decrypt 또는 로컬 폴백)."""
    global _pepper_cache
    if _pepper_cache is None:
        _pepper_cache = _load_pepper()
    return _pepper_cache


def apply_pepper(pbkdf2_hex: str) -> str:
    """PBKDF2 hex 출력에 HMAC-SHA256(pepper)을 적용한 hex 반환."""
    return hmac.new(get_pepper(), pbkdf2_hex.encode("utf-8"), hashlib.sha256).hexdigest()
