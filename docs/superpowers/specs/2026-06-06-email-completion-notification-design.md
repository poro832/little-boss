# 문서 완료 이메일 알림 (SNS) 설계

- 날짜: 2026-06-06
- 대상: `backend/` (이메일 가입 유저)
- 상태: 설계 승인됨, 구현 대기

## 목표

이메일/비밀번호로 가입한 유저가 업로드한 문서의 분석이 완료되면, **가입한 이메일로
완료 알림 메일**을 보낸다. SES가 IAM으로 완전 차단돼 있어 SES 대신 **SNS**를 쓴다.

## 접근: 단일 SNS 토픽 + user_id 필터 정책

- 알림 토픽 1개(`littleboss-user-notifications`)를 쓰고, 유저별로 이메일을 구독하되 각 구독에
  **FilterPolicy `{"user_id": ["<그 유저 id>"]}`** 를 건다.
- 완료 시 **MessageAttribute `user_id`** 를 붙여 Publish → 필터가 일치하는 **그 유저 구독만**
  메일을 받는다. (토픽 난립 없이 개인 타겟)

확인된 권한(2026-06-06, sgu-pj-03 user 레벨): `sns:CreateTopic`·`sns:Subscribe`·`sns:Publish` 허용,
`sns:DeleteTopic` 차단(미사용이라 무관). [[email-completion-notification]], [[aws-iam-permission-boundary]] 참고.

## 비목표 (YAGNI)

- Google 로그인 유저 알림 — 이들은 백엔드 `signup()` 훅을 안 거치고 user_id가 이메일이 아니라
  sub다. 이번 범위는 "회원가입(이메일/비번) 유저"로 한정.
- 구독 해제(`sns:Unsubscribe`) — 알림 끄기는 "발행 안 함"(설정 토글)으로 처리. 구독은 둔다.
- HTML 메일 / 커스텀 발신주소 — SNS 이메일은 평문 + AWS 발신주소(합의된 트레이드오프).
- SES 경로 — 차단 상태. 별도 [[email-completion-notification]] 추적.

## SNS 제약 (설계에 반영)

- **Subject는 ASCII만** 허용(≤100자, 줄바꿈/제어문자 불가). → 제목은 영문 고정,
  한글 내용은 **본문(Message, UTF-8 가능)** 에 넣는다.
- 미확인 구독으로 Publish해도 에러가 아니라 **그냥 미발송**.
- 구독 시 AWS가 "Subscription Confirmation" 메일을 보내고 유저가 **1회 확인 클릭** 해야
  이후 알림이 온다(이메일 인증과 유사, 합의됨).

## 신규 모듈: `backend/utils/notify_email.py`

단일 책임: "유저를 알림 토픽에 구독시키고, 완료 알림을 그 유저에게만 발행한다." 전부 best-effort.

```python
def subscribe_user(email: str, user_id: str) -> bool:
    """가입/로그인 시 1회: 이메일을 알림 토픽에 구독(FilterPolicy=user_id). 성공 시 True."""

def notify_done(doc: dict) -> bool:
    """문서 분석 완료 시: 해당 유저(user_id)에게만 완료 알림 Publish. 발행 시 True."""
```

동작 규칙:
- `ENV == "local"` 또는 `USER_NOTIFY_TOPIC_ARN` 미설정이면 **no-op으로 False** 반환(로컬·미배포 안전).
- `subscribe_user`: `boto3 sns.subscribe(TopicArn, Protocol="email", Endpoint=email,
  Attributes={"FilterPolicy": json.dumps({"user_id": [str(user_id)]})}, ReturnSubscriptionArn=True)`.
- `notify_done`:
  - `user_id = doc["user_id"]`. 없으면 False.
  - 설정 확인: `get_user(user_id)`의 `notif_settings.get("mail", True)`가 False면 발송 안 함(False).
  - Subject(ASCII 고정): `"LittleBoss - document analysis complete"`.
  - Message(UTF-8): `'{document_type}' 문서 분석이 완료되었습니다.` + 마감(deadlines: `date desc`)
    및 필요서류(required_documents: name) 요약 줄들.
  - `sns.publish(TopicArn, Subject, Message, MessageAttributes={"user_id":
    {"DataType":"String","StringValue": str(user_id)}})`.
- 모든 예외는 `try/except`로 잡아 로그만 남기고 False 반환(호출부 절대 안 깨짐).

## 훅 (얇게 2곳)

1. `backend/handlers/auth_handler.py`
   - `signup`: 유저 저장 후 `subscribe_user(email, email)` 호출(best-effort). 성공하면 유저 레코드에
     `notify_email_subscribed = True` 저장(중복 구독·중복 확인메일 방지).
   - `login`: 이메일 유저인데 `notify_email_subscribed`가 없으면(기존 가입자) `subscribe_user` 1회
     호출 후 성공 시 플래그 저장(지연 마이그레이션).
2. `backend/handlers/ai_handler.py`
   - `process`: status=done 저장 직후, 기존 `notify_slack_done(doc)` 옆에 `notify_email_done(doc)`
     추가(try/except로 감싸 분석 성공 불변). 모듈 경로: `from utils.notify_email import notify_done as notify_email_done`.

## 일회성 셋업 (CLI / CloudShell)

1. 토픽 생성:
   `aws sns create-topic --name littleboss-user-notifications --region ap-northeast-2`
   → 출력 `TopicArn` 확보.
2. Lambda 환경변수 `USER_NOTIFY_TOPIC_ARN`에 그 ARN 설정:
   - 구독은 `signup`/`login`이 도는 **upload-handler**(`sgu-pj-03-upload-handler`)에.
   - 발행은 `ai_handler.process`가 도는 **ai-analyzer** 람다에.
   - ⚠️ `update-function-configuration --environment`는 env 맵 전체를 덮어쓰므로 **기존 env와 jq merge 필수**
     ([[kms-password-pepper]]의 주의와 동일).
3. **람다 역할 권한 프리체크(구현 1단계):** upload-handler 역할에 `sns:Subscribe`,
   ai-analyzer 역할에 `sns:Publish` 필요. Publish는 기존 `_publish_sns`가 이미 쓰므로 ai-analyzer엔 있을
   가능성 큼. upload-handler의 `sns:Subscribe`가 없으면 그 부분만 관리자에 권한 요청.

## 에러 처리

- subscribe/publish 실패 → 로그 + False. signup·login·분석 파이프라인은 영향 없음.
- 토픽 ARN 미설정/로컬 → 조용히 no-op.
- 미확인 구독 → SNS가 알아서 미발송(앱은 신경 안 씀).

## 테스트 (로컬, boto3 모킹)

`backend/tests/test_notify_email.py` — 저장소 테스트 컨벤션(sys.path.insert, `__main__` 러너) 따름.

1. `ENV=local`이면 `subscribe_user`/`notify_done`가 False(no-op).
2. `ENV=production` + 토픽 ARN 설정 + `boto3.client`를 가짜로 monkeypatch:
   - `subscribe_user`가 sns.subscribe를 올바른 인자(Protocol email, FilterPolicy user_id)로 호출.
   - `notify_done`가 sns.publish를 user_id MessageAttribute와 함께 호출, Subject가 ASCII.
   - `notif_settings.mail=False` 유저면 publish 안 함(False).
   - doc에 user_id 없으면 False.
3. 메시지 본문에 마감·필요서류 요약이 포함되는지.

## 영향 파일

- `backend/utils/notify_email.py` — 신규
- `backend/handlers/auth_handler.py` — signup/login 훅 추가
- `backend/handlers/ai_handler.py` — 완료 시 notify_email_done 훅 추가
- `backend/tests/test_notify_email.py` — 신규

## 리스크

- upload-handler 람다 역할에 `sns:Subscribe`가 없으면 구독이 런타임에 실패(가입은 안 깨지나 알림 미작동)
  → 구현 1단계에서 확인, 없으면 권한 요청.
- 유저가 AWS 확인메일을 안 누르면 알림 미수신(설계상 수용).
- 발신주소·평문 한계(설계상 수용).
