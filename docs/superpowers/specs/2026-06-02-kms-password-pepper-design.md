# KMS 페퍼 기반 비밀번호 강화 설계

- 날짜: 2026-06-02
- 대상: `backend/handlers/auth_handler.py` (이메일/비밀번호 인증)
- 상태: 설계 승인됨, 구현 대기

## 목표

DynamoDB `users` 테이블이 통째로 유출(덤프/무단 조회)되더라도, KMS 키 없이는
저장된 비밀번호 해시를 오프라인 무차별 대입으로 복원할 수 없게 만든다.

비밀번호 저장 자체(PBKDF2-HMAC-SHA256, 10만 회, 사용자별 랜덤 salt, 상수시간 비교)는
이미 안전하므로 그대로 두고, 그 위에 **KMS로 보호되는 서버측 페퍼(pepper)** 한 겹을 추가한다.

## 비목표 (YAGNI)

- 테이블 at-rest 암호화를 고객관리 CMK로 전환(방식 A) — 앱/IAM 조회 유출엔 효과가 적어 이번 범위 제외.
- 매 요청 KMS HMAC 호출(방식 B1) — 지연·비용·`GenerateMac` 권한 부담으로 제외.
- 기존 사용자 강제 비밀번호 재설정 — 투명 마이그레이션으로 대체.
- Google OAuth 토큰 등 다른 시크릿의 KMS 전환 — 별도 작업(`kms-secrets-deferred` 참고).

## 핵심 메커니즘

해시 함수를 한 겹 확장한다.

```
기존 (v1): password_hash = PBKDF2_HMAC_SHA256(password, salt, 100_000)
신규 (v2): password_hash = HMAC_SHA256(key=pepper, msg=PBKDF2_HMAC_SHA256(password, salt, 100_000))
```

- PBKDF2 단계는 변경 없음. 그 출력(hex)에 페퍼로 HMAC을 한 번 더 적용.
- `pepper`: 32바이트 랜덤값. KMS로 암호화되어 평문은 DynamoDB·git·코드 어디에도 없음.
- v1과 v2는 "HMAC 적용 여부"로 구분 → 투명 마이그레이션이 가능.

## 페퍼 로딩 (`backend/utils/pepper.py`, 신규)

- 모듈 전역 변수에 평문 페퍼를 캐시한다.
- 최초 1회만 `kms:Decrypt(base64decode(env PEPPER_CIPHERTEXT))` 호출 → 평문 페퍼를 메모리에 보관.
  이후 동일 콜드스타트 내 요청은 KMS를 호출하지 않는다(콜드스타트당 1회).
- **로컬/테스트 폴백**: `os.getenv("ENV") == "local"`이면 KMS 대신 `LOCAL_PEPPER` 환경변수의
  값을 페퍼로 사용한다. KMS 없이 개발·단위테스트가 가능해야 한다.
- **fail-closed**: KMS 복호 실패 또는 페퍼 미설정 시 예외를 전파하여 인증을 거부한다.
  절대 평문/무페퍼 비교로 우회하지 않는다.

### 인터페이스

```python
# backend/utils/pepper.py
def get_pepper() -> bytes:
    """캐시된 평문 페퍼 반환. 최초 호출 시 KMS Decrypt(또는 로컬 폴백). 실패 시 예외."""

def apply_pepper(pbkdf2_hex: str) -> str:
    """PBKDF2 hex 출력에 HMAC-SHA256(pepper)를 적용한 hex 문자열 반환."""
```

## 데이터 모델 변경 (DynamoDB `users`, 스키마리스 → 무중단)

- `hash_version` 속성 추가:
  - 기존 레코드: 속성 없음 → **v1로 간주**.
  - 신규/마이그레이션 레코드: `2`.
- `salt`, `password_hash`는 이름·역할 유지(v2에서는 값에 HMAC이 포함됨).

## `auth_handler.py` 변경 지점

내부 헬퍼를 버전 인식형으로 정리한다.

- `_pbkdf2(password, salt) -> hex` : 기존 `_hash_pw`의 PBKDF2 부분.
- `_secure_hash(value, salt) -> hex` : 현재 버전(v2) 해시 = `apply_pepper(_pbkdf2(value, salt))`.

함수별 동작:

- `signup`: `hash_version=2`, `password_hash=_secure_hash(password, salt)`로 저장.
- `change_password`, `confirm_reset`: 새 비밀번호를 v2로 저장(`hash_version=2`).
- `login`: 버전 인식 검증.
  - `user.get("hash_version") == 2` → `_secure_hash(password, salt)` 비교.
  - 그 외(기존 v1) → `_pbkdf2(password, salt)` 비교. **성공 시 즉시 v2로 재해시·저장**
    (`password_hash`, `hash_version=2` 갱신). 사용자는 변화를 느끼지 못함.
- `request_reset`의 `reset_code` 해시: `_secure_hash(code, salt)`로 통일.
  코드는 매번 새로 생성되므로 버전 마이그레이션 이슈가 없다. `verify_reset`/`confirm_reset`도 동일 함수로 비교.
- 모든 비교는 기존대로 `secrets.compare_digest`(상수시간) 유지.

## 일회성 인프라 셋업 (`scripts/setup_pepper_kms.py`, 신규)

IAM 제약상 `iam:PutRolePolicy`가 차단되어 있으므로, Lambda 역할 권한은
**KMS 키 정책(key policy)** 으로 부여한다.

스크립트가 수행(관리자 자격으로 1회 실행):

1. 대칭 KMS 키 생성(`kms:CreateKey`, boundary 허용).
2. 키 정책에 Lambda 실행 역할의 `kms:Decrypt` 허용 구문 추가.
3. 32바이트 랜덤 페퍼 생성 → `kms:Encrypt` → base64 ciphertext 출력.
4. 출력된 ciphertext를 Lambda 환경변수 `PEPPER_CIPHERTEXT`에 수동 설정(절대 git 커밋 금지).

> 셋업 1단계 실행 시 `kms:Encrypt`(관리자) / `kms:Decrypt`(Lambda 역할)가 현재 boundary에서
> 실제로 동작하는지 즉시 확인한다. 막혀 있으면 구현 진행 전에 보고한다.

## 에러 처리

- 페퍼 미설정/KMS 복호 실패: 인증 함수가 예외를 던지고 호출부는 5xx로 응답(fail-closed).
- 마이그레이션 중 v1 유저의 재저장 실패: 로그인 자체는 성공시키되, 재해시 저장 실패는
  로그로 남기고 다음 로그인에 재시도되게 한다(승격은 멱등).

## 테스트 (로컬 페퍼로 KMS 없이 수행)

1. v2 해시·검증 왕복: 올바른 비밀번호 통과, 오답 거부.
2. v1→로그인→v2 자동 승격: v1 형태 레코드를 만들고 로그인 → 성공 + `hash_version`이 2로 갱신됨.
3. `change_password`/`confirm_reset` 후 레코드가 v2로 저장됨.
4. 페퍼가 다르면 동일 비밀번호라도 해시가 달라짐(페퍼가 실제로 섞이는지 검증).
5. 상수시간 비교 경로 유지 확인.

## 영향 파일

- `backend/utils/pepper.py` — 신규
- `backend/handlers/auth_handler.py` — 수정
- `scripts/setup_pepper_kms.py` — 신규(일회성)
- 테스트 파일 — 신규(로컬 페퍼 기반)

## 리스크 (정직한 한계)

- 페퍼가 콜드스타트 후 Lambda 메모리에 상주 → 메모리 덤프/RCE 시 노출 가능(B1 대비 유일한
  약점, 합의된 트레이드오프).
- KMS 장애 시 로그인 불가(fail-closed). 발생 빈도 매우 낮음.
- 셋업 시 `kms:Encrypt`/`kms:Decrypt`가 boundary에서 막히면 진행 불가 → 1단계에서 조기 확인.
