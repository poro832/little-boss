# 마감 알림 서버 배포 (CloudShell)

프론트·백엔드 코드는 이미 `main`에 있다. 남은 건 AWS 쪽 4단계다.
**CloudShell에서 위에서부터 순서대로** 실행한다. 각 단계 끝에 확인 명령이 있으니
결과를 보고 다음으로 넘어간다.

| 값 | 내용 |
|---|---|
| 계정 | `443370697536` |
| 리전 | `ap-northeast-2` |
| 대상 Lambda | `sgu-pj-03-upload-handler` |
| 역할 | `SafeRole-sgu-pj` |
| 발송 시각 | 매일 09:00 KST |

---

## 0. 공통 변수

```bash
export AWS_REGION=ap-northeast-2
export FN=sgu-pj-03-upload-handler
export ROLE_ARN=arn:aws:iam::443370697536:role/SafeRole-sgu-pj
```

현재 런타임을 확인한다. 아래 3단계에서 같은 파이썬으로 패키지를 받아야 한다.

```bash
aws lambda get-function-configuration --function-name $FN \
  --query '{runtime:Runtime, timeout:Timeout, memory:MemorySize}' --output table
```

---

## 1. VAPID 키 생성

웹 푸시는 서버가 자기 신원을 서명으로 증명해야 한다. 그 키쌍을 한 번만 만든다.

```bash
pip install --quiet --user py-vapid
export PATH="$HOME/.local/bin:$PATH"

cd ~ && mkdir -p vapid && cd vapid
vapid --gen                    # private_key.pem, public_key.pem 생성
vapid --applicationServerKey   # 프론트에 넣을 공개키가 출력된다
```

`Application Server Key = ` 뒤의 문자열이 **공개키**다. 따로 적어둔다(5단계에서 쓴다).

개인키를 환경변수에 넣을 형식으로 바꾼다.

`pywebpush`는 PEM이나 **raw 32바이트 개인키의 urlsafe base64**를 받는다.
`openssl ... -outform DER | base64` 는 SEC1 DER 전체를 표준 base64로 내보내므로
형식이 맞지 않는다 — 아래처럼 raw 스칼라만 뽑아야 한다.

```bash
export VAPID_PRIV=$(python3 - <<'EOF'
from cryptography.hazmat.primitives import serialization
import base64
k = serialization.load_pem_private_key(open('private_key.pem','rb').read(), password=None)
raw = k.private_numbers().private_value.to_bytes(32, 'big')
print(base64.urlsafe_b64encode(raw).decode().rstrip('='))
EOF
)
echo "길이: ${#VAPID_PRIV}"     # 43 이어야 한다 (32바이트 -> base64url)
```

> 개인키는 로그·깃·슬랙 어디에도 남기지 않는다. 이 셸에서만 쓴다.

---

## 2. Lambda 환경변수 추가 — **여기가 가장 위험한 단계**

`--environment`는 **기존 변수를 통째로 대체한다.** 그냥 덮어쓰면
`PEPPER_CIPHERTEXT` 같은 기존 값이 사라져 비밀번호 로그인이 깨진다.
(실제로 한 번 겪은 사고다.)

**반드시 읽어서 병합한다.**

```bash
# ① 현재 값을 그대로 받아온다
aws lambda get-function-configuration --function-name $FN \
  --query 'Environment.Variables' > /tmp/env-before.json
cat /tmp/env-before.json          # 기존 키들이 보이는지 눈으로 확인

# ② 새 키 3개를 병합한다 (기존 키는 건드리지 않는다)
jq --arg k "$VAPID_PRIV" \
   '. + {VAPID_PRIVATE_KEY:$k,
         VAPID_SUBJECT:"mailto:poro832@gmail.com",
         APP_URL:"https://poro832.github.io/little-boss/app.html"}' \
   /tmp/env-before.json > /tmp/env-after.json

# ③ 키 개수가 늘어나기만 했는지 확인 (줄었으면 절대 진행하지 말 것)
echo "before: $(jq 'keys|length' /tmp/env-before.json) 개"
echo "after : $(jq 'keys|length' /tmp/env-after.json) 개"
diff <(jq -r 'keys[]' /tmp/env-before.json) <(jq -r 'keys[]' /tmp/env-after.json)

# ④ 적용
aws lambda update-function-configuration --function-name $FN \
  --environment "Variables=$(jq -c . /tmp/env-after.json)"
```

확인 — 값은 가리고 키 이름만 본다.

```bash
aws lambda get-function-configuration --function-name $FN \
  --query 'Environment.Variables | keys' --output table
```

---

## 3. 코드 배포 (푸시 라이브러리 포함)

웹 푸시는 서명(ES256)과 본문 암호화(AES-GCM)가 필요해 `pywebpush`가 있어야 한다.
`cryptography`가 네이티브라 패키지가 5MB쯤 커진다. **CloudShell은 리눅스라
그냥 설치하면 된다** — 휠을 따로 고를 필요가 없다.

`from pywebpush import ...`는 평범한 임포트라 **zip 루트에 설치**하면 Lambda가
바로 찾는다. 별도 `vendor/` 폴더나 `sys.path` 조작은 필요 없다.

```bash
cd ~ && rm -rf little-boss && git clone -q https://github.com/poro832/little-boss.git

rm -rf /tmp/pkg && mkdir -p /tmp/pkg
cp -r ~/little-boss/backend/handlers ~/little-boss/backend/models ~/little-boss/backend/utils /tmp/pkg/
pip install -q -t /tmp/pkg pywebpush

find /tmp/pkg -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null
cd /tmp/pkg && zip -qr /tmp/backend-push.zip .
du -h /tmp/backend-push.zip        # 6~8MB 정도면 정상
```

배포 — **upload-handler에만** 올린다. `ai-analyzer`, `action-executor`는
푸시를 쓰지 않으므로 가볍게 둔다.

```bash
aws lambda update-function-code --function-name $FN \
  --zip-file fileb:///tmp/backend-push.zip --query 'LastModified'

aws lambda wait function-updated --function-name $FN && echo "배포 완료"
```

기존 API가 안 깨졌는지 먼저 본다.

```bash
aws lambda invoke --function-name $FN \
  --payload '{"path":"/health","httpMethod":"GET"}' --cli-binary-format raw-in-base64-out \
  /tmp/health.json >/dev/null && cat /tmp/health.json
```

---

## 4. 스캔을 수동으로 한 번 돌려본다

스케줄을 걸기 **전에** 직접 호출해 본다. 여기서 실패하면 스케줄을 걸어도 소용없다.

```bash
aws lambda invoke --function-name $FN \
  --payload '{"task":"deadline-scan"}' --cli-binary-format raw-in-base64-out \
  /tmp/scan.json >/dev/null && cat /tmp/scan.json
```

`{"users":0,"sent":0,"removed":0,"errors":0}` 형태가 나오면 성공이다.
아직 아무도 알림을 켜지 않았으니 `users:0`이 정상이다.

`errors`가 0이 아니면 로그를 본다.

```bash
aws logs tail /aws/lambda/$FN --since 5m --filter-pattern "deadline-scan"
```

---

## 5. 프론트에 공개키 넣기

공개키는 이름 그대로 공개값이라 워크플로에 평문으로 둬도 된다.
`.github/workflows/deploy.yml`의 `env:` 아래에 한 줄 추가한다.

```yaml
      VITE_API_URL: https://7al1rzghkf.execute-api.ap-northeast-2.amazonaws.com/prod
      VITE_GOOGLE_CLIENT_ID: 889650272637-a0dfrs6froqhnkbchso0hjcq544u442d.apps.googleusercontent.com
      VITE_VAPID_PUBLIC_KEY: <1단계에서 받은 Application Server Key>
```

커밋해서 `main`에 올리면 배포가 돌고, 그때부터 "마감 알림" 토글이 실제로 구독을 만든다.
이 키가 없으면 토글을 켜도 "서버 준비 중" 안내만 뜬다(권한은 묻지 않는다).

---

## 6. 매일 09:00 KST 스케줄 생성

`events:PutRule`(classic EventBridge Rules)은 막혀 있고 **EventBridge Scheduler는 열려 있다.**
`ScheduleExpressionTimezone`을 쓰면 UTC로 환산할 필요가 없다.

```bash
FN_ARN=$(aws lambda get-function --function-name $FN --query 'Configuration.FunctionArn' --output text)

# 타깃은 JSON 안에 JSON이라 셸 이스케이프가 까다롭다. jq로 만들고 눈으로 확인한다.
jq -n --arg arn "$FN_ARN" --arg role "$ROLE_ARN" \
  '{Arn:$arn, RoleArn:$role,
    Input:"{\"task\":\"deadline-scan\"}",
    RetryPolicy:{MaximumRetryAttempts:0}}' > /tmp/target.json

cat /tmp/target.json

aws scheduler create-schedule \
  --name lb-deadline-scan \
  --schedule-expression 'cron(0 9 * * ? *)' \
  --schedule-expression-timezone 'Asia/Seoul' \
  --flexible-time-window 'Mode=OFF' \
  --target file:///tmp/target.json
```

`MaximumRetryAttempts=0`인 이유 — 재시도되면 같은 알림이 두 번 간다.
(코드에도 `last_notified` 기록으로 2차 방어가 있지만, 스케줄에서 막는 게 먼저다.)

확인:

```bash
aws scheduler get-schedule --name lb-deadline-scan \
  --query '{state:State, expr:ScheduleExpression, tz:ScheduleExpressionTimezone, target:Target.Arn}' --output table
```

---

## 7. 동작 확인

1. 폰이나 PC에서 https://poro832.github.io/little-boss/app.html 접속
2. 내 정보 > 알림 설정 > **마감 알림** 켜기 → 브라우저 권한 허용
3. 아래로 구독이 저장됐는지 확인

```bash
aws dynamodb scan --table-name sgu-pj-03-users \
  --filter-expression "attribute_exists(push_subs)" \
  --query 'Items[].{user:user_id.S, subs:push_subs.L[0].M.endpoint.S}' --output table
```

4. D-7/D-3/D-1에 걸리는 문서를 만들고 스캔을 직접 돌려 본다

```bash
aws lambda invoke --function-name $FN \
  --payload '{"task":"deadline-scan"}' --cli-binary-format raw-in-base64-out \
  /tmp/scan.json >/dev/null && cat /tmp/scan.json
```

`sent`가 1 이상이면 알림이 실제로 나간 것이다.

---

## 되돌리기

```bash
# 스케줄만 제거 (코드·환경변수는 유지)
aws scheduler delete-schedule --name lb-deadline-scan

# 환경변수를 배포 전으로 되돌리기 (2단계에서 받아둔 파일 사용)
aws lambda update-function-configuration --function-name $FN \
  --environment "Variables=$(jq -c . /tmp/env-before.json)"
```

---

## 알아둘 한계

- 웹 푸시는 **기기가 켜져 있고 브라우저가 살아 있을 때** 도착한다. 노트북이 꺼져
  있으면 깨어난 뒤에 온다. "실시간 보장"으로 설명하면 안 된다.
- iPhone은 **홈 화면에 추가한 PWA**에서만 동작한다(iOS 16.4+). Safari 탭에서는
  권한 요청 자체가 실패한다. 앱이 그 상황을 감지해 안내한다.
- 매일 users 테이블 전체를 Scan한다. 수십~수백 명에서는 문제없지만 수천 명이
  되면 구독 전용 테이블이나 GSI로 옮겨야 한다.
- 개인키를 Lambda 환경변수에 평문으로 둔다. KMS 전환은 별도 과제다.
