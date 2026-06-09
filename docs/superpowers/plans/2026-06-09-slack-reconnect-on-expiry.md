# Slack 연동 만료 시 재연동 링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack 사용자의 Google 연동(refresh token)이 만료되면 분석 완료 시 죽은 연동을 지우고 재연동 OAuth 링크를 스레드에 올린다.

**Architecture:** `slack_oauth`에서 `invalid_grant`를 `TokenExpiredError`로 감지하고 연동 링크 빌더(`build_connect_url`)를 공용화. `slack_handler._ingest`가 문서에 `slack_user`를 실어두면, `action_handler.notify_slack_done`이 완료 시 만료를 잡아 `delete_link`로 죽은 연동을 지우고 재연동 링크를 게시한다.

**Tech Stack:** Python 3.11 stdlib(urllib), 기존 테스트 컨벤션(`backend/tests/test_*.py`, `sys.path.insert`, `__main__` 러너, `python tests/<f>.py`로 직접 실행, monkeypatch).

---

## File Structure

- `backend/utils/slack_oauth.py` — **수정**. `TokenExpiredError`, `refresh_access_token`(invalid_grant 감지), `build_connect_url` 추가.
- `backend/handlers/slack_handler.py` — **수정**. `_ingest`가 `slack_user`를 extra에 저장 + `build_connect_url` 사용 + import 정리.
- `backend/handlers/action_handler.py` — **수정**. `notify_slack_done`이 만료 시 `delete_link` + 재연동 링크 게시.
- `backend/tests/test_slack_reconnect.py` — **신규**. slack_oauth 단위 테스트.

순서: Task 1(slack_oauth) → Task 2(slack_handler) → Task 3(action_handler). 2·3은 Task 1의 새 함수에 의존.

---

### Task 1: `slack_oauth` — 만료 감지 + 링크 빌더

**Files:**
- Modify: `backend/utils/slack_oauth.py`
- Test: `backend/tests/test_slack_reconnect.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_slack_reconnect.py`:

```python
import os, sys, io, json
import urllib.error
os.environ.setdefault("SLACK_SIGNING_SECRET", "testsecret")
os.environ.setdefault("API_BASE", "https://api.example.com/prod")
os.environ.setdefault("GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils import slack_oauth
from utils.slack_oauth import build_connect_url, refresh_access_token, TokenExpiredError, verify_state


def test_build_connect_url_contains_params_and_valid_state():
    url = build_connect_url("U123", "C1", "169.7")
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=client-123" in url
    assert "%2Fslack%2Fgoogle%2Fcallback" in url  # redirect_uri 인코딩됨
    from urllib.parse import parse_qs, urlparse
    state = parse_qs(urlparse(url).query)["state"][0]
    ok, data = verify_state("testsecret", state)
    assert ok and data["slack_user_id"] == "U123" and data["channel"] == "C1" and data["thread_ts"] == "169.7"


def _fake_http_error(code, body):
    return urllib.error.HTTPError("https://oauth2.googleapis.com/token", code, "err", {}, io.BytesIO(body.encode()))


def test_refresh_access_token_raises_token_expired_on_invalid_grant():
    slack_oauth.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(_fake_http_error(400, json.dumps({"error": "invalid_grant"})))
    raised = False
    try:
        refresh_access_token("cid", "secret", "dead-token")
    except TokenExpiredError:
        raised = True
    assert raised


def test_refresh_access_token_reraises_other_errors():
    slack_oauth.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(_fake_http_error(500, "server error"))
    got_expired = False
    got_other = False
    try:
        refresh_access_token("cid", "secret", "tok")
    except TokenExpiredError:
        got_expired = True
    except Exception:
        got_other = True
    assert got_other and not got_expired


if __name__ == "__main__":
    test_build_connect_url_contains_params_and_valid_state()
    test_refresh_access_token_raises_token_expired_on_invalid_grant()
    test_refresh_access_token_reraises_other_errors()
    print("OK")
```

- [ ] **Step 2: 실패 확인** — From `backend`: `python tests/test_slack_reconnect.py`
Expected: FAIL — `ImportError: cannot import name 'build_connect_url'` (또는 `TokenExpiredError`).

- [ ] **Step 3: 구현** — `backend/utils/slack_oauth.py` 수정:

(a) 상단 import에 추가 (기존 `import urllib.parse` 아래):
```python
import os
import urllib.error
```

(b) import 블록 바로 아래에 예외 클래스 추가:
```python
class TokenExpiredError(Exception):
    """Google refresh token 만료/철회 (invalid_grant)."""
    pass
```

(c) 기존 `refresh_access_token` 함수를 다음으로 교체:
```python
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
```

(d) `sign_state` 함수 정의 아래(또는 파일 끝)에 링크 빌더 추가:
```python
def build_connect_url(slack_user: str, channel: str, thread_ts: str) -> str:
    """Slack 사용자용 Google 캘린더 연동 OAuth URL (서명된 state 포함)."""
    state = sign_state(os.environ["SLACK_SIGNING_SECRET"], slack_user, channel, thread_ts)
    redirect = f"{os.environ['API_BASE']}/slack/google/callback"
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": redirect,
        "response_type": "code", "scope": "https://www.googleapis.com/auth/calendar.events email",
        "access_type": "offline", "prompt": "consent", "state": state})
```

- [ ] **Step 4: 통과 확인** — From `backend`:
- `python tests/test_slack_reconnect.py` → `OK`
- 회귀: `python tests/test_oauth_state.py` → `OK`

- [ ] **Step 5: 커밋**
```bash
git add backend/utils/slack_oauth.py backend/tests/test_slack_reconnect.py
git commit -m "feat(slack): refresh 만료 감지(TokenExpiredError) + 연동 링크 빌더"
```

---

### Task 2: `slack_handler._ingest` — slack_user 저장 + 링크 빌더 사용

**Files:**
- Modify: `backend/handlers/slack_handler.py`

**현재 `_ingest` 관련 코드:**
```python
import urllib.parse
from utils.slack_oauth import sign_state
...
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
```

- [ ] **Step 1: import 교체** — 파일 상단에서:
  - `import urllib.parse` 줄을 **삭제**(이 변경 후 미사용).
  - `from utils.slack_oauth import sign_state` → `from utils.slack_oauth import build_connect_url`.

- [ ] **Step 2: extra에 slack_user 추가** — `process(...)` 호출의 extra를 교체:
```python
    result = process(filename, data, user_id, extra={
        "source": "slack", "slack_channel": channel, "slack_thread_ts": ts, "slack_user": slack_user})
```

- [ ] **Step 3: 미연결 분기를 build_connect_url로 교체** — 위 `if not email:` 블록 전체를 다음으로 교체:
```python
    if not email:
        auth = build_connect_url(slack_user, channel, ts)
        post_message(token, channel, ts,
                     f"📎 문서 분석을 시작했어요. 일정을 *개인 Google 캘린더*에 자동 등록하려면 계정을 연결하세요:\n{auth}")
    else:
        post_message(token, channel, ts, "📎 문서 분석을 시작했어요. 완료되면 결과를 여기에 올릴게요.")
```

- [ ] **Step 4: 검증** — From `backend`:
```bash
python -c "import ast; s=open('handlers/slack_handler.py',encoding='utf-8').read(); ast.parse(s); print('SYNTAX OK'); print('slack_user in extra:', '\"slack_user\": slack_user' in s); print('uses build_connect_url:', 'build_connect_url(slack_user, channel, ts)' in s); print('no urllib.parse:', 'import urllib.parse' not in s); print('no sign_state import:', 'import sign_state' not in s)"
```
Expected: `SYNTAX OK` + 네 줄 모두 `True`.

import 스모크:
```bash
python -c "import sys; sys.path.insert(0,'.'); from handlers import slack_handler; print('IMPORT OK')"
```
Expected: `IMPORT OK`.

- [ ] **Step 5: 커밋**
```bash
git add backend/handlers/slack_handler.py
git commit -m "feat(slack): _ingest에 slack_user 저장 + build_connect_url 사용"
```

---

### Task 3: `action_handler.notify_slack_done` — 만료 시 재연동 링크

**Files:**
- Modify: `backend/handlers/action_handler.py`

**현재 `notify_slack_done`의 캘린더 등록 블록:**
```python
    cal = ""
    email = doc.get("user_id", "")
    rt = get_refresh_token(email) if "@" in (email or "") else None
    if rt:
        try:
            from utils.slack_oauth import refresh_access_token
            access = refresh_access_token(os.environ["GOOGLE_CLIENT_ID"], os.environ["GOOGLE_CLIENT_SECRET"], rt)
            r = handle_calendar(doc["doc_id"], access)
            cal = f"\n🗓️ 캘린더 {r.get('count', 0)}건 등록 완료"
        except Exception as e:
            print(f"[SLACK_CAL_ERROR] {e}")
            cal = "\n⚠️ 캘린더 등록 실패(연결이 만료됐으면 다음 업로드 때 재연결 안내를 드려요)"
```

- [ ] **Step 1: 블록 교체** — 위 블록을 다음으로 교체:
```python
    cal = ""
    email = doc.get("user_id", "")
    slack_user = doc.get("slack_user", "")
    rt = get_refresh_token(email) if "@" in (email or "") else None
    if rt:
        from utils.slack_oauth import refresh_access_token, TokenExpiredError, build_connect_url
        from utils.slack_links import delete_link
        try:
            access = refresh_access_token(os.environ["GOOGLE_CLIENT_ID"], os.environ["GOOGLE_CLIENT_SECRET"], rt)
            r = handle_calendar(doc["doc_id"], access)
            cal = f"\n🗓️ 캘린더 {r.get('count', 0)}건 등록 완료"
        except TokenExpiredError:
            # 연동 만료/철회 → 죽은 연동 삭제 + 재연동 링크 안내
            if slack_user:
                delete_link(slack_user)
                link = build_connect_url(slack_user, ch, ts)
                cal = f"\n⚠️ Google 연결이 만료됐어요. 다시 연결해주세요:\n{link}"
            else:
                cal = "\n⚠️ Google 연결이 만료됐어요. 다음 업로드 때 다시 연결해주세요."
        except Exception as e:
            print(f"[SLACK_CAL_ERROR] {e}")
            cal = "\n⚠️ 캘린더 등록 실패 (잠시 후 다시 시도해주세요)"
```

(`ch`, `ts`는 함수 앞부분 `ch, ts = doc.get("slack_channel"), doc.get("slack_thread_ts")`로 이미 정의돼 있음.)

- [ ] **Step 2: 검증** — From `backend`:
```bash
python -c "import ast; s=open('handlers/action_handler.py',encoding='utf-8').read(); ast.parse(s); print('SYNTAX OK'); print('TokenExpiredError:', 'except TokenExpiredError' in s); print('delete_link:', 'delete_link(slack_user)' in s); print('build link:', 'build_connect_url(slack_user, ch, ts)' in s)"
```
Expected: `SYNTAX OK` + 세 줄 모두 `True`.

import 스모크 + 회귀:
```bash
python -c "import os,sys; os.environ['ENV']='local'; sys.path.insert(0,'.'); from handlers import action_handler; print('IMPORT OK', hasattr(action_handler,'notify_slack_done'))"
python tests/test_slack_links.py
python tests/test_slack_reconnect.py
python tests/test_oauth_state.py
```
Expected: `IMPORT OK True`, 이어서 각 테스트 `OK`.

- [ ] **Step 3: 커밋**
```bash
git add backend/handlers/action_handler.py
git commit -m "feat(slack): 연동 만료 시 죽은 연동 삭제 + 재연동 링크 게시"
```

---

## Self-Review

**1. Spec coverage**
- invalid_grant 감지(TokenExpiredError) → Task 1 (refresh_access_token + 테스트). ✓
- build_connect_url 공용화 → Task 1(정의) + Task 2(_ingest 사용) + Task 3(만료 분기 사용). ✓
- slack_user를 문서에 저장 → Task 2(extra). ✓
- 완료 시 만료→delete_link+링크, 일시오류→일반 메시지, 정상→등록완료 → Task 3. ✓
- slack_user 없는 옛 문서 폴백 → Task 3(`if slack_user: ... else: 일반 안내`). ✓
- 테스트(build_connect_url state 검증, invalid_grant→TokenExpiredError, 비-만료 재전파) → Task 1. ✓
- notify_slack_done 본체는 통합성격 → import/구문 스모크 → Task 3 Step 2. ✓

**2. Placeholder scan:** 모든 코드 단계 실제 코드. TBD/TODO 없음. ✓

**3. Type/이름 일관성:** `TokenExpiredError`·`build_connect_url(slack_user, channel/ch, thread_ts/ts)`·`refresh_access_token`·`delete_link`·`get_refresh_token`·`sign_state`/`verify_state` 정의(Task 1, 기존)와 사용(Task 2·3, 테스트) 일치. extra 키 `slack_user`(Task 2 저장) ↔ `doc.get("slack_user")`(Task 3 읽기) 일치. ✓
