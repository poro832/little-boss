# 문서 완료 이메일 알림(SNS) 일회성 셋업

리전 `ap-northeast-2`. sgu-pj-03 CloudShell에서 실행.

## 1. 알림 토픽 생성
```bash
aws sns create-topic --name littleboss-user-notifications --region ap-northeast-2
# 출력된 TopicArn 복사 (예: arn:aws:sns:ap-northeast-2:443370697536:littleboss-user-notifications)
```

## 2. Lambda 환경변수 USER_NOTIFY_TOPIC_ARN 설정
구독은 upload-handler(가입/로그인), 발행은 ai-analyzer(완료)가 한다. 두 함수 모두에 설정.
⚠️ `update-function-configuration --environment`는 env 맵 전체를 덮어쓰므로 기존값과 jq merge 필수.

```bash
TOPIC_ARN="<위에서 복사한 ARN>"
for FN in sgu-pj-03-upload-handler sgu-pj-03-ai-analyzer; do
  ENVJSON=$(aws lambda get-function-configuration --function-name "$FN" \
    --region ap-northeast-2 --query 'Environment.Variables' --output json)
  MERGED=$(echo "$ENVJSON" | jq --arg t "$TOPIC_ARN" '. + {USER_NOTIFY_TOPIC_ARN: $t}')
  aws lambda update-function-configuration --function-name "$FN" \
    --region ap-northeast-2 --environment "Variables=$MERGED"
done
```
(함수명이 다르면 실제 이름으로 교체. ai-analyzer 정확한 함수명은 `aws lambda list-functions --query "Functions[].FunctionName"`로 확인.)

## 3. 람다 역할 권한 프리체크 (중요)
- upload-handler 역할에 `sns:Subscribe`, ai-analyzer 역할에 `sns:Publish` 필요.
- 역할 ARN 확인: `aws lambda get-function-configuration --function-name <FN> --query Role`.
- 막혀 있으면 관리자에게 해당 역할에 위 액션 추가 요청(자가 부여는 iam:PutRolePolicy 차단).
- Publish는 기존 `_publish_sns`가 이미 쓰므로 ai-analyzer엔 있을 가능성 큼. upload-handler의 Subscribe가 관건.

## 4. 코드 배포
backend/를 zip으로 묶어 upload-handler·ai-analyzer에 `update-function-code` 배포
(handlers+models+utils, __pycache__ 제외). notify_email.py가 zip에 포함되는지 확인.

## 5. 검증
이메일 신규 가입 → AWS "Subscription Confirmation" 메일 도착 → 확인 클릭 →
문서 업로드 → 분석 완료 시 가입 이메일로 "LittleBoss - document analysis complete" 수신.
