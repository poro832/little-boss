# LittleBoss — AWS Bedrock 설정 가이드

> 리전: `us-east-1` (ap-northeast-2 차단으로 인해 버지니아 사용)
> 인증: IAM Role `SafeRole-sgu-pj` (API Key 불필요)
> 사용 모델: `us.anthropic.claude-haiku-4-5-20251001-v1:0`

---

## 왜 Bedrock인가

| 항목 | Gemini API | Bedrock |
|------|-----------|---------|
| 인증 | API Key 필요 | IAM Role 자동 인증 |
| Lambda 설정 | 환경변수에 키 저장 | 환경변수 불필요 |
| 비용 | 외부 과금 | AWS 계정 내 과금 |
| 로컬 개발 | ✅ 사용 | ❌ 로컬 미사용 (Gemini 대체) |

> 로컬: `AI_PROVIDER=gemini` / Lambda 프로덕션: `AI_PROVIDER=bedrock`

---

## Step 1 — 모델 액세스 확인

> ✅ AWS 정책 변경: 모델 액세스 페이지 폐지됨 (2026년~)
> 이제 모델을 처음 호출하면 자동으로 활성화됩니다.

**Anthropic 모델 최초 사용 시 주의사항:**
- 계정 최초 호출 시 **Use case 제출**이 필요할 수 있음
- Bedrock 콘솔 → `us-east-1` → **모델 카탈로그** → `Claude Haiku` → **Playground에서 한 번 실행**
- Playground에서 정상 응답이 오면 Lambda에서도 바로 사용 가능

별도 신청/승인 대기 없음 — Playground 테스트 후 바로 Step 4로 이동

---

## Step 2 — Lambda 환경변수 확인

Lambda 함수 `sgu-pj-03-ai-analyzer`에 아래 환경변수가 설정되어 있어야 합니다:

| 변수 | 값 |
|------|----|
| `AI_PROVIDER` | `bedrock` |
| `BEDROCK_REGION` | `us-east-1` |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

Lambda 콘솔 → `sgu-pj-03-ai-analyzer` → 구성 → 환경 변수에서 확인/설정

---

## Step 3 — 동작 방식

```
ai_handler.handle(event)          ← DynamoDB Streams 트리거
    ↓
utils/ai.py → analyze()
    ↓
AI_PROVIDER=bedrock 이면
    ↓
_analyze_bedrock(text, image_path)
    ↓
boto3.client("bedrock-runtime", region_name="us-east-1")
    ↓
invoke_model(modelId="us.anthropic.claude-haiku-4-5-20251001-v1:0")
    ↓
JSON 파싱 → 마감일/준비물/캘린더 이벤트 반환
```

### 텍스트 문서 (PDF 텍스트 추출 성공)
```python
content = PROMPT_TEMPLATE.format(text=text)
```

### 이미지/스캔 PDF (`__IMAGE_FILE__` 반환 시)
```python
content = [
    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64}},
    {"type": "text", "text": PROMPT_TEMPLATE.format(text="[첨부 이미지 참고]")}
]
```

---

## Step 4 — CloudShell에서 Bedrock 연결 테스트

Lambda 배포 전 CloudShell에서 직접 확인:

```bash
# 모델 응답 테스트
aws bedrock-runtime invoke-model \
  --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":100,"messages":[{"role":"user","content":"안녕하세요. 한국어로 짧게 답해주세요."}]}' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1 \
  output.json && cat output.json
```

`content[0].text`에 응답이 오면 정상입니다.

---

## 로컬 개발 설정

로컬에서는 Bedrock 대신 Gemini를 사용합니다. `backend/.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## 트러블슈팅

| 오류 | 원인 | 해결 |
|------|------|------|
| `AccessDeniedException` | 모델 액세스 미신청 | Step 1 재확인 |
| `ResourceNotFoundException` | 잘못된 model_id | `BEDROCK_MODEL_ID` 환경변수 확인 |
| `ValidationException` | 요청 형식 오류 | `anthropic_version` 필드 확인 |
| 리전 오류 | ap-northeast-2 차단 | `BEDROCK_REGION=us-east-1` 확인 |
