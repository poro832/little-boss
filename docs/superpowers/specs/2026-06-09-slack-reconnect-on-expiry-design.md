# Slack 연동 만료 시 재연동 링크 설계

- 날짜: 2026-06-09
- 대상: `backend/` (Slack 봇 Google 캘린더 연동)
- 상태: 설계 승인됨, 구현 대기

## 목표

Slack 사용자의 저장된 Google 캘린더 연동(refresh token)이 만료/철회되면(테스트 모드라 7일
만료), 분석 완료 알림 시 단순 "실패" 메시지 대신 **죽은 연동을 지우고 새 연동(재연결) OAuth
링크를 스레드에 올린다.**

## 현재 동작 / 갭

- `slack_handler._ingest`: 연결 안 된 유저(`get_email_for_slack` → None)에게만 연동 링크를 올림.
  이미 연결된 유저는 토큰이 죽었어도 "연결됨"으로 보고 링크를 안 줌.
- `action_handler.notify_slack_done`: 완료 시 저장된 refresh token으로 캘린더 등록을 시도하고,
  실패하면 `except Exception`으로 잡아 `"⚠️ 캘린더 등록 실패(…다음 업로드 때 재연결 안내…)"`
  텍스트만 올림 — **재연동 링크 없음.** 만료와 일시적 오류를 구분하지 않음.

## 설계

### 1. 만료를 정확히 감지 (`utils/slack_oauth.py`)

Google은 refresh token이 만료/철회되면 토큰 엔드포인트가 `invalid_grant`(HTTP 400)를 반환한다.

- `import os`, `import urllib.error` 추가(현재 없음).
- `class TokenExpiredError(Exception): pass` 추가.
- `refresh_access_token`을 수정: `urllib.error.HTTPError`를 잡아 `code == 400` 이고 본문에
  `"invalid_grant"`가 있으면 `TokenExpiredError`를 raise, 그 외 에러는 그대로 re-raise.
  (만료 vs 일시적 오류 구분)

### 2. 연동 링크 빌더 공용화 (`utils/slack_oauth.py`)

현재 `_ingest`에 인라인으로 박힌 OAuth URL 생성 로직을 함수로 추출:

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

`_ingest`(미연결)와 `notify_slack_done`(만료) 둘 다 이걸 재사용한다 (DRY).

### 3. slack_user를 문서에 실어 나르기 (`slack_handler._ingest`)

완료 시점에서 `delete_link`·재연동 링크 state를 만들려면 **slack_user_id가 필요**한데 현재
문서엔 없다. `process(... extra=...)`의 extra에 `"slack_user": slack_user` 추가 → 문서 레코드에 저장.

또한 `_ingest`의 미연결 분기를 인라인 URL 생성 대신 `build_connect_url(slack_user, channel, ts)`
호출로 교체(2번 추출 결과 사용). 이에 따라 `slack_handler`의 `sign_state` import는
`build_connect_url`로 교체하고, 더 이상 안 쓰는 `import urllib.parse`는 제거.

### 4. 완료 시점 처리 (`action_handler.notify_slack_done`)

`slack_user = doc.get("slack_user", "")`를 읽고, refresh+등록 블록을 수정:

```python
    if rt:
        from utils.slack_oauth import refresh_access_token, TokenExpiredError, build_connect_url
        from utils.slack_links import delete_link
        try:
            access = refresh_access_token(os.environ["GOOGLE_CLIENT_ID"], os.environ["GOOGLE_CLIENT_SECRET"], rt)
            r = handle_calendar(doc["doc_id"], access)
            cal = f"\n🗓️ 캘린더 {r.get('count', 0)}건 등록 완료"
        except TokenExpiredError:
            if slack_user:
                delete_link(slack_user)                          # 죽은 연동 삭제(매핑+토큰)
                link = build_connect_url(slack_user, ch, ts)
                cal = f"\n⚠️ Google 연결이 만료됐어요. 다시 연결해주세요:\n{link}"
            else:
                cal = "\n⚠️ Google 연결이 만료됐어요. 다음 업로드 때 다시 연결해주세요."
        except Exception as e:
            print(f"[SLACK_CAL_ERROR] {e}")
            cal = "\n⚠️ 캘린더 등록 실패 (잠시 후 다시 시도해주세요)"
```

- 만료(`TokenExpiredError`) → `delete_link(slack_user)`(죽은 연동 삭제) + 재연동 링크 게시.
- 일시적 오류 → 연동 유지, 일반 재시도 메시지(링크 없음).
- 정상 → 기존 "🗓️ 캘린더 N건 등록 완료".

`delete_link`가 `slack#<id>` 매핑과 토큰을 지우므로, 만료 후 다음 업로드는 `_ingest`에서
미연결로 취급돼 링크가 다시 뜬다. 링크 클릭 → `/slack/google/callback` → `save_link`로 복구.

## 비목표 (YAGNI)

- 업로드 시점(`_ingest`)에서의 사전 만료 감지 — 완료 시점 한 곳만(사용자 합의).
- refresh token 7일 만료 자체 해결(OAuth 앱을 production으로) — 별개 운영 작업.
- 만료 외 자동 재시도/큐잉.

## 에러 처리

- 모든 Slack/캘린더 경로는 best-effort(분석 성공 불변). 만료 처리 실패해도 최종 `post_message`는 시도.
- `slack_user`가 없는 옛 문서(배포 전 업로드분)는 만료 시 링크 없이 일반 안내로 폴백.

## 테스트 (`backend/tests/`, 기존 컨벤션: sys.path.insert + `__main__` 러너)

신규 `test_slack_reconnect.py`:
1. `build_connect_url`이 client_id·redirect(`/slack/google/callback`)·state를 포함한 URL을 반환하고,
   그 state가 `verify_state`로 검증되며 slack_user/channel/thread_ts가 복원된다(환경변수 셋업).
2. `refresh_access_token`이 `invalid_grant` 본문의 HTTP 400에 대해 `TokenExpiredError`를 던진다
   (slack_oauth의 `urllib.request.urlopen`을 가짜로 monkeypatch해 `urllib.error.HTTPError`를 발생).
3. 비-만료 오류(예: HTTP 500)는 `TokenExpiredError`가 아니라 원래 예외로 전파된다.

`notify_slack_done` 본체는 슬랙 전송·`handle_calendar` 의존이라 단위테스트 대신
import/구문 스모크로 확인.

## 영향 파일

- `backend/utils/slack_oauth.py` — 수정(import os/urllib.error, TokenExpiredError, refresh_access_token, build_connect_url)
- `backend/handlers/slack_handler.py` — 수정(extra에 slack_user, build_connect_url 사용, import 정리)
- `backend/handlers/action_handler.py` — 수정(notify_slack_done 만료 분기)
- `backend/tests/test_slack_reconnect.py` — 신규

## 리스크

- slack_user는 배포 이후 업로드분부터 문서에 실림 → 그 전 in-flight 문서는 만료 시 폴백(링크 없음). 수용.
- `invalid_grant` 외 만료 시그널(드묾)은 일시적 오류로 분류될 수 있음 — 그 경우 다음 업로드에서
  delete_link 없이 일반 메시지. 큰 문제 아님(7일 만료의 주 경로는 invalid_grant).
