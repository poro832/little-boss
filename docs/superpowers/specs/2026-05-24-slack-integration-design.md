# LittleBoss × Slack 연동 설계

- 작성일: 2026-05-24
- 상태: 설계 승인됨 · IAM 제약 반영해 구현 설계 확정(아래 ADDENDUM)

## ADDENDUM (2026-05-24, IAM 제약 반영 — 이게 최종 구현 설계)

권한 점검 결과 사용자(`sgu-pj-03`)는 **`iam:PutRolePolicy`·`secretsmanager:CreateSecret`·`dynamodb:UpdateTimeToLive`·SES 차단**, 반면 **Lambda 생성·`iam:PassRole`·기존 Lambda 코드 수정·API Gateway 리소스 생성·기존 테이블 R/W·S3 put**은 허용. 따라서 본문의 SQS/Secrets Manager/KMS/신규 테이블 기반 설계를 아래로 **대체**한다:

- **비동기 큐(SQS) 제거.** 무거운 분석은 이미 S3 업로드가 트리거하는 기존 파이프라인이 처리하므로, `slack-handler`는 **경량 ingest만**(서명검증 → 파일 다운로드 → 기존 `process()`로 S3 put+doc 생성 → 즉시 ack). 분석·캘린더·알림은 기존 비동기 파이프라인 끝(`action-executor`)에서.
- **신규 Lambda 2개**: `sgu-pj-03-slack-handler`(POST /slack/events), `sgu-pj-03-google-oauth`(GET /slack/google/callback). 둘 다 기존 `SafeRole-sgu-pj` 사용. (worker·SQS 불필요)
- **신규 테이블 대신 기존 `users` 테이블 재사용**(역할 권한 확실):
  - `user_id="slack#<slack_user_id>"` 항목 → `{email}` (Slack→이메일 매핑)
  - `user_id="<email>"` 사용자 항목에 `google_refresh_token` 필드(at-rest 저장)
  - `user_id="evt#<event_id>"` 항목 + 조건부 put → 멱등(중복 처리 방지)
- **시크릿은 Lambda 환경변수**(Secrets Manager 대체): `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **KMS 봉투암호화 제거** → refresh token은 DynamoDB at-rest 암호화 + IAM 접근 제한에 의존.
- 3초 룰: ingest가 3초 초과 시 Slack 재시도 → `evt#` 멱등으로 흡수.
- 앞서 생성한 SQS 큐·`slack-links`/`slack-events` 테이블·KMS 키는 미사용(정리 가능).

## Context (왜 하는가)

현재 LittleBoss는 **웹에서 행정 문서를 업로드 → S3 → Textract/직접추출 → Bedrock(Opus) 분석 → 마감·필요서류·일정 추출 → DynamoDB 저장 → 대시보드/개인 Google 캘린더**로 동작한다. 분석 파이프라인은 API Gateway(`7al1rzghkf`) 뒤에 Lambda 4종(`sgu-pj-03-{upload-handler, ocr-handler, ai-analyzer, action-executor}`)으로 잘 분리돼 있다.

팀이 일상적으로 쓰는 **Slack에 문서를 올리면** 자동으로 분석·등록되고, **각자 개인 Google 캘린더에 일정이 저장**되며, **결과 알림까지** 받는 흐름을 원한다. 분석 엔진은 이미 검증됐으므로(엔드포인트 16개 prod E2E 통과), 이 작업은 **Slack이라는 "입구"와 "출구" 어댑터를 기존 파이프라인 앞뒤에 붙이는 것**이 핵심이다.

## 결정 사항 (확정)

| 항목 | 결정 |
|---|---|
| 트리거 | Slack 파일 업로드 (`file_shared` 이벤트) |
| 일정 저장 | **각자 개인 Google 캘린더** (Slack↔Google 계정 연결 + 서버측 refresh token) |
| 사용 범위 | 내부 워크스페이스 1개 (Slack 앱 심사 불필요) |
| 알림 위치 | 업로드한 **스레드에 답글** (Block Kit) |
| 신원 통합 | Google 연결 시 **그 이메일을 LittleBoss `user_id`로 사용** → Slack 업로드 문서와 웹 문서가 같은 계정·대시보드에 모임 |

## 아키텍처 (신규 구성요소)

기존 파이프라인·분석엔진은 변경하지 않는다.

| 구성요소 | 역할 |
|---|---|
| Slack 앱 (내부) | 봇 스코프 `files:read`·`chat:write`·`im:write`, `file_shared` 이벤트 구독 → API GW 전송 |
| `slack-handler` Lambda (신규) | Slack 서명 검증, URL 검증 챌린지, **3초 내 200 ack**, SQS로 비동기 위임, 이벤트 멱등 처리 |
| `slack-worker` Lambda (신규, SQS 소비) | 연결 여부 확인 → 파일 다운로드(봇 토큰) → **기존 S3 업로드 경로 투입** |
| `google-oauth-callback` Lambda (신규) | Google OAuth 콜백 → refresh token 저장(계정 연결) |
| 알림 스텝 (`action-executor` 끝에 추가) | 분석 완료 시 스레드 답글 + refresh token으로 개인 캘린더 등록 |
| SQS(+DLQ) | slack-handler→worker 비동기 버퍼(재시도·실패 격리) |

## 데이터 흐름

**연결된 사용자:**
```
Slack 채널 파일 업로드
 → file_shared → API GW → slack-handler (서명검증, 즉시 ack, 멱등 체크)
 → SQS → slack-worker
      → slack-links에서 연결 확인 + refresh token 조회
      → Slack 파일 다운로드 → 기존 S3 업로드 경로 투입
        (doc: source=slack, slack_channel, slack_thread_ts, user_id=Google이메일)
 → [기존] OCR/직접추출 → Bedrock 분석 → DynamoDB
 → action-executor:
      → refresh token → 액세스토큰 재발급 → 개인 Google 캘린더 등록(create_events)
      → Slack 스레드 답글: 분석요약 + 마감 + 필요서류 체크리스트 + 등록 결과
```

**미연결 사용자:** 분석은 그대로 진행 + 스레드에 결과 답글 + "캘린더 자동 등록하려면 Google 연결: <OAuth 링크>". 한 번 연결하면 이후 완전 자동.

## 계정 연결 (OAuth offline)

1. 미연결 사용자에게 봇이 링크 게시: `accounts.google.com/o/oauth2/v2/auth?...&scope=calendar.events email&access_type=offline&prompt=consent&state=<HMAC 서명된 slack_user_id+thread>`
2. 동의 → `google-oauth-callback`이 code→토큰 교환 → refresh_token + 이메일 확보
3. 저장: `slack_user_id → { email(=user_id), refresh_token(KMS 암호화), linked_at }` → Slack "연결 완료" 답글
4. 캘린더 등록 시: refresh_token → Google 토큰엔드포인트로 액세스토큰 재발급 → 기존 `utils/calendar.create_events`

> 기존 웹 Google 로그인은 클라이언트의 단명 토큰이라 서버 자동등록에 못 쓴다. **offline refresh_token이 핵심 신규 요소.**

## 데이터 모델 추가

- 신규 테이블 `sgu-pj-03-slack-links`: `slack_user_id`(PK), `email`, `refresh_token_enc`, `linked_at`
- `documents` 레코드 필드 추가: `source:"slack"`, `slack_channel`, `slack_thread_ts`
- 멱등성: `processed_events`(file_id/event_id, TTL) — Slack 재시도로 인한 **중복 캘린더 등록 방지**

## 보안

- `state`는 HMAC 서명 + 짧은 TTL (타 Slack 계정 연결 위조 방지)
- 시크릿(Slack signing secret·봇 토큰·Google client secret)은 **Secrets Manager** — 커밋 금지
- **refresh_token은 KMS 봉투암호화** 후 DynamoDB 저장
- Slack 요청 **서명 검증**(signing secret + timestamp 5분 윈도우)

## 에러·엣지케이스 (전부 스레드 답글로 안내)

- 미지원 형식(.hwp/.doc)·20MB 초과 → 기존 검증 재사용해 안내
- 분석 실패 → 에러 답글
- refresh_token 만료/철회 → "재연결: <링크>" + 저장 토큰 삭제
- 한 메시지에 여러 파일 → 파일별 처리(`file_shared`가 파일별 발생)

## 새로 필요한 인프라

- Slack 앱 매니페스트(스코프·이벤트 구독 URL·인터랙션)
- SQS 큐 + DLQ
- Lambda 신규: `slack-handler`, `slack-worker`, `google-oauth-callback`
- API Gateway 라우트: `POST /slack/events`, `GET /slack/google/callback`
- DynamoDB 테이블 `sgu-pj-03-slack-links`
- Secrets Manager 항목(위 시크릿)
- Google OAuth 클라이언트: 리디렉트 URI 추가 + offline 동의
- ⚠️ **IAM 선행 확인**: SafeRole-sgu-pj에 SQS·Secrets Manager·KMS·`lambda:InvokeFunction` 권한 필요. SES가 막혔던 전례가 있으므로 **착수 전 관리자에게 권한 가능 여부 확인** 필수.

## 테스트

- 단위: Slack 서명 검증, state HMAC, 멱등 dedup
- 모킹: Slack 파일 다운로드, Google 토큰 교환
- E2E: 테스트 Slack 워크스페이스 + 테스트 Google 계정 → 업로드→분석→개인 캘린더 등록→스레드 답글

## 구현 단계 (권장 순서)

1. Slack 앱 생성 + `slack-handler`(서명검증·ack·챌린지) + SQS — "파일 올리면 봇이 스레드에 '접수' 답글" 까지
2. `slack-worker` → 기존 S3 업로드 경로 연결 → 분석 결과를 스레드 답글 (캘린더 제외)
3. `google-oauth-callback` + slack-links 저장 + 미연결 시 연결 링크
4. action-executor에 refresh token 기반 개인 캘린더 자동 등록 + 결과 답글
5. 에러·멱등·만료 재연결 마감

## 범위 밖 (YAGNI)

- 멀티 워크스페이스 배포 / Slack 앱 스토어 심사
- 공용 캘린더, SMS, 마감 리마인더 스케줄러(별도 EventBridge 작업)
- Block Kit 인터랙션(필요서류 버튼 체크 등) — 추후 확장
