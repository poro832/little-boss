# LittleBoss AWS 계정 권한 분석

> 학교에서 제공받은 AWS 계정 (`sgu-pj-01`)의 실제 권한을 테스트로 확인한 결과입니다.
> 작성일: 2026-04-14

---

## 계정 기본 정보

| 항목 | 값 |
|------|-----|
| 계정 ID | `443370697536` |
| 사용자 ARN | `arn:aws:iam::443370697536:user/sgu-pj-01` |
| 소속 그룹 | `sgu-pj` |
| 그룹 정책 | `sancho-policy` (인라인, 내용 조회 불가) |
| 추가 제약 정책 | `arn:aws:iam::443370697536:policy/ControlOnlyOwnResource` |
| 기본 리전 | `ap-northeast-2` (서울) |

---

## 🔑 핵심 규칙

### 1. 네이밍 규칙: `sgu-pj-01-` 접두사 필수

대부분의 리소스 생성 시 이름에 **`sgu-pj-01-` 접두사**가 붙어야 허용됩니다.

| 리소스 타입 | 접두사 필수? | 비고 |
|------------|-------------|------|
| S3 버킷 | ✅ 필수 | `sgu-pj-01-*` 외에는 명시적 거부 |
| Lambda 함수 | ✅ 필수 | `ControlOnlyOwnResource` 정책으로 제한 |
| API Gateway | ✅ 필수 | 이름 기반 제어 |
| EventBridge 스케줄 그룹 | ✅ 필수 | 이름 기반 제어 |
| DynamoDB 테이블 | ⚠️ 권장 | 접두사 없이도 됐지만 일관성을 위해 권장 |
| SNS 토픽 | ⚠️ 권장 | 접두사 없이도 됐지만 일관성을 위해 권장 |

### 2. `ControlOnlyOwnResource` 정책

**본인이 만든 리소스만 조작 가능**합니다.
- 다른 사용자가 만든 Lambda/리소스는 조회/수정 불가
- 예: `lecture_6` Lambda 조회 시 `AccessDeniedException`

### 3. IAM 역할 생성 불가

- `iam:CreateRole` 명시적 거부
- `access-analyzer:ValidatePolicy` 거부
- **→ 기존 역할을 재사용해야 함**

---

## ✅ 사용 가능한 권한 (테스트 검증됨)

### 생성 가능 리소스
| 서비스 | 액션 | 테스트 결과 |
|--------|------|------------|
| S3 | 버킷 생성 (`sgu-pj-01-*`) | ✅ 성공 |
| S3 | 객체 업로드/다운로드 | ✅ 성공 |
| DynamoDB | 테이블 생성 | ✅ 성공 |
| DynamoDB | 테이블 삭제 | ✅ 성공 |
| Lambda | 함수 생성 | ✅ 성공 |
| Lambda | 함수 삭제 | ✅ 성공 |
| API Gateway | REST API 생성 | ✅ 성공 |
| API Gateway | API 삭제 | ✅ 성공 |
| SNS | 토픽 생성 | ✅ 성공 |
| EventBridge Scheduler | 스케줄 그룹 생성 | ✅ 성공 |
| EventBridge Scheduler | 스케줄 그룹 삭제 | ✅ 성공 |

### 조회 가능 서비스
- S3, DynamoDB, Lambda, API Gateway, SNS, EventBridge Scheduler
- CloudWatch Logs
- IAM (list 전용, 정책 내용은 조회 불가)

---

## ❌ 제한된 권한

| 서비스 | 제한된 액션 | 상세 |
|--------|------------|------|
| IAM | `CreateRole`, `PutRolePolicy` | 역할 생성/수정 불가 |
| IAM | `GetRolePolicy`, `GetGroupPolicy` | 정책 내용 조회 불가 |
| IAM | `GetRole` (일부 역할) | NoSuchEntity 오류 |
| Access Analyzer | `ValidatePolicy` | 명시적 거부 |
| S3 | 접두사 없는 `CreateBucket` | 명시적 거부 |
| SNS | `DeleteTopic` | 권한 없음 |
| Lambda (타인 것) | `GetFunction`, `InvokeFunction` | 본인 리소스가 아니면 거부 |

---

## 🧩 사용 가능한 IAM 역할 (Lambda 실행용)

IAM 역할 생성이 불가하므로 아래 **기존 역할** 중에서 선택해야 합니다:

| 역할 이름 | 용도 추정 |
|----------|----------|
| **`Nxt-Lambda-Basic-Role`** | ★ **일반 Lambda 실행용 (권장)** |
| `Nxt-Lambda-Bedrock-Role` | AI/Bedrock 호출용 |
| `Lambda_CostSlackbot-role-82vqlqtt` | 특정 봇 전용 |
| `Lambda_ResourceCreationTagging-role-savtlu7t` | 태깅 Lambda 전용 |
| `Lambda_StopInstances-role-bpu2dumv` | EC2 중지 Lambda 전용 |

> ⚠️ 역할에 실제로 어떤 권한이 붙어있는지 조회할 수 없습니다.
> 실제로 Lambda에서 S3, DynamoDB, Textract 등을 호출해봐야 됩니다.
> 권한이 부족하면 관리자에게 요청하거나 다른 역할을 시도해야 합니다.

### 역할 ARN (Lambda 생성 시 사용)
```
arn:aws:iam::443370697536:role/Nxt-Lambda-Basic-Role
```

---

## 📋 LittleBoss 프로젝트 적용 변경사항

### 리소스 이름 변경 (접두사 추가)

| 원래 이름 | 변경된 이름 |
|----------|------------|
| `littleboss-documents-bucket` | `sgu-pj-01-littleboss-docs` |
| `littleboss-frontend` | `sgu-pj-01-littleboss-frontend` |
| `littleboss-users-table` | `sgu-pj-01-users` |
| `littleboss-documents-table` | `sgu-pj-01-documents` |
| `littleboss-checklists-table` | `sgu-pj-01-checklists` |
| `littleboss-upload-handler` | `sgu-pj-01-upload-handler` |
| `littleboss-ocr-handler` | `sgu-pj-01-ocr-handler` |
| `littleboss-ai-analyzer` | `sgu-pj-01-ai-analyzer` |
| `littleboss-action-executor` | `sgu-pj-01-action-executor` |
| `littleboss-dependencies` (Layer) | `sgu-pj-01-dependencies` |
| `littleboss-api` (API Gateway) | `sgu-pj-01-littleboss-api` |
| `littleboss-deadline-alerts` (SNS) | `sgu-pj-01-deadline-alerts` |
| `littleboss-reminders` (Scheduler 그룹) | `sgu-pj-01-littleboss-reminders` |

### Lambda 실행 역할
- ~~~~`littleboss-lambda-role` 생성~~~~ → `Nxt-Lambda-Basic-Role` 재사용

---

## ⚠️ 런타임 위험 요소 (실제 실행 시 확인 필요)

`Nxt-Lambda-Basic-Role`의 실제 권한을 알 수 없으므로, 아래 작업이 런타임에 실패할 수 있습니다:

| Lambda 함수 | 필요 권한 | 실패 가능성 |
|------------|----------|-----------|
| upload-handler | S3 Presigned URL, DynamoDB Put | 낮음 (기본 권한에 포함 가능) |
| ocr-handler | S3 Get, **Textract 호출**, DynamoDB Update | **중간** (Textract 권한 미확인) |
| ai-analyzer | S3 Get/Put, DynamoDB Update, 외부 Gemini API | 낮음 (외부 API는 IAM과 무관) |
| action-executor | DynamoDB, **SNS Publish**, **EventBridge Scheduler** | **중간** (SNS/Scheduler 권한 미확인) |

**대응 방안**:
1. Lambda를 만든 뒤 실제로 실행하여 권한 오류를 확인
2. 오류 발생 시 Lambda의 CloudWatch Logs에서 어떤 권한이 거부되었는지 확인
3. 관리자에게 필요 권한을 `Nxt-Lambda-Basic-Role`에 추가 요청

---

## 🔍 권한 추가 확인 방법 (선택)

### IAM Policy Simulator (콘솔)
1. https://policysim.aws.amazon.com 접속
2. User `sgu-pj-01` 선택
3. 테스트할 서비스/액션 선택 → Run Simulation

### CLI로 실제 액션 테스트
```bash
# 예시: Textract 호출 가능 여부
aws textract detect-document-text \
  --document '{"S3Object":{"Bucket":"sgu-pj-01-littleboss-docs","Name":"test.pdf"}}' \
  --region ap-northeast-2
```

---

## 📝 관리자 문의 템플릿

권한이 부족할 경우 아래 내용으로 요청:

```
안녕하세요, LittleBoss 프로젝트 진행 중 AWS 계정 sgu-pj-01의
권한 관련 문의드립니다.

현재 확인된 제약:
1. Nxt-Lambda-Basic-Role의 실제 권한을 조회할 수 없어 확인이 어렵습니다.
2. Lambda에서 다음 서비스를 호출해야 하는데 실행 권한이 있는지 확인 부탁드립니다:
   - Textract (analyze_document, start_document_analysis)
   - SNS Publish
   - EventBridge Scheduler (CreateSchedule)
   - DynamoDB Streams

부족한 권한이 있다면 Nxt-Lambda-Basic-Role 또는 별도 역할에
추가해주시거나 사용 가능한 역할을 안내해주시면 감사하겠습니다.
```
