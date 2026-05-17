# LittleBoss 변경 사항 정리

> 최종 업데이트: 2026-05-17
> 리포지토리: https://github.com/poro832/little-boss

---

## 1. 프론트엔드 변경 사항

### 1-1. 프론트엔드 코드 이관 (`eaeba34`)
- `aosxou/2026_CapstoneProject`의 UI 코드를 우리 repo `frontend/`로 이관, 직접 관리 시작
- 스택: React 18 + Vite (단일 `LittleBoss.jsx`)

### 1-2. 백엔드 API 연동 (`eaeba34`)
- `api.js` 신규: axios 클라이언트 + `pollUntilDone` 폴링 헬퍼
- `main.jsx`: `GoogleOAuthProvider` 래핑
- `package.json`: `@react-oauth/google`, `axios`, `jwt-decode` 추가
- **Google 로그인 실연동**: `GoogleBtn` → `useGoogleLogin` (scope: `calendar.events`), 토큰 localStorage 저장
- **파일 업로드**: 목업 진행바 제거 → 실제 `uploadFile` + 분석 폴링
- **분석 결과 카드**: 문서종류·요약·마감일·준비서류·캘린더 등록 버튼

### 1-3. 목업 화면 → 실데이터 (그룹 A·B)

**그룹 A** (`1d5a430`, `3ea5124`, `df32e74`)
| 화면 | 변경 |
|------|------|
| Dashboard 최근 분석 문서 | 실제 문서 목록 + 상태 자동판정 |
| 진행 중인 문서 | 마감 전 문서 + 실제 체크리스트 + D-day |
| 마감된 문서 | 마감 지난 문서 필터 |
| 일정 관리 목록 | D-day 정렬 |
| 사용자 이름/이메일 | Google/이메일가입/로그인 통합 `getUser()` → Header·Dashboard·Profile |
| 마감 임박 카드 | 가장 임박한 실제 문서 + 동적 진행률 원형 그래프 |
| 일정 상세 | title 매칭 실제 분석 데이터 |
| 알림 드롭다운 | D-7 이내 마감 + 분석완료 문서 동적 생성 |

**그룹 B** (`5355455`)
- `api.js`에 `deadlinesForMonth()` 헬퍼 추가
- Dashboard "다가오는 일정" 캘린더: 실제 마감일 표시 + 클릭 이동
- SchedulePage 캘린더: 하드코딩 3월 → **동적 월 이동 + 오늘 표시 + 실제 마감일**

### 1-4. 아직 목업 (그룹 C — 백엔드 API 없음)
- 공지사항 페이지
- 알림 설정 / 프로필 저장
- 이메일·비밀번호 인증 (백엔드는 Google OAuth만)

---

## 2. 백엔드 변경 사항

### 2-1. 문서 처리 파이프라인 수정 (`df13769`)
- `ocr.py`: 다중 페이지 PDF 비동기 Textract (`start_document_text_detection`)
- `ai.py`: `__IMAGE_FILE__` 케이스 S3에서 읽도록 수정 (`open()` → `get_file()`)
- `ai_handler.py`: S3 이벤트 + DynamoDB Streams 양쪽 호환
- `storage.py`: `put_s3_json` 헬퍼

### 2-2. 코드 점검·견고성 개선 (`9df6038`)
- `ocr_handler.py`: 불필요한 `get_file()` 전체 다운로드 제거
- `ocr_handler.py`: S3 우회 마커 제거 — **이중 트리거 위험 제거** (DynamoDB Streams 정상화로 불필요)
- `ai.py`: Gemini `response.text` None 방어
- `ai.py`: Bedrock 응답 구조 KeyError/IndexError 방어
- `ai.py`: `_parse_response` 강화 (None 방어 + JSON 객체 추출 2차 폴백)
- `make_test_pdf.py`: 한글 텍스트 테스트 PDF 생성 유틸 추가

### 2-3. Google Calendar 연동 (`20c1e97`)
- `utils/calendar.py` 신규: Calendar API 이벤트 등록 + D-7/D-3/D-1 리마인더
- `action_handler.py`: 캘린더 등록 + SNS 알림 발송 통합

---

## 3. AWS 인프라 / 권한 진행

### 완료
- S3 버킷, DynamoDB 테이블 3개, SNS 토픽+이메일 구독
- Lambda 함수 4개 배포, API Gateway 7개 엔드포인트 (prod)
- S3 → ocr-handler 트리거
- **DynamoDB Streams → ai-analyzer 트리거** (CTO 권한 부여로 해결)
- Textract 비동기 권한 (해결)
- `bedrock:InvokeModel` 명시적 Deny (CTO 해결)

### Bedrock 모델 확정 (2026-05-17 해결 완료)
- `claude-haiku-4-5`는 AWS Marketplace 미구독으로 차단됨
- 검증 결과 **`us.anthropic.claude-opus-4-7`(Opus 4.7) 구독 완료 상태** 확인
- ai-analyzer `BEDROCK_MODEL_ID` → `us.anthropic.claude-opus-4-7` 확정 (비용은 회사 부담)
- opus-4-6, sonnet-4-6도 사용 가능 (haiku-4-5만 미구독)

### ✅ E2E 검증 완료 (2026-05-17)
```
업로드 → S3 → ocr-handler(Textract) → DynamoDB(ocr_done)
  → DynamoDB Streams → ai-analyzer(Opus 4.7) → DynamoDB(done)
  → 마감일·준비서류·캘린더 일정 구조화 ✅
```
- **전 구간 완주 확인** (status: done, 에러 없음)
- 실제 추출 예시: 문서종류·요약·마감일 3건·준비서류 3건·캘린더 일정 4건
- Opus 4.7이 Textract 부분 추출(날짜·숫자)에서도 맥락 추론하여 정확히 구조화
- 스캔 PDF는 graceful 안내 메시지로 처리 (크래시 없음)

---

## 4. 커밋 히스토리

| 커밋 | 날짜 | 내용 |
|------|------|------|
| `9df6038` | 05-17 | 파이프라인 코드 점검·견고성 개선 |
| `df13769` | 05-17 | 스캔 PDF 버그 + S3 우회 |
| `5355455` | 05-16 | 그룹 B — 캘린더 그리드 실데이터 |
| `df32e74` | 05-16 | 그룹 A — 마감임박/일정상세/알림 |
| `3ea5124` | 05-16 | 사용자 이름/이메일 표시 |
| `1d5a430` | 05-16 | 목업 화면 실데이터 연동 |
| `eaeba34` | 05-16 | 프론트엔드 이관 + API 연동 |
| `ff8520d` | 05-12 | 프론트엔드 설정 가이드 |
| `20c1e97` | 05-12 | Google Calendar + SNS |
| `d10d7ac` | 05-10 | AWS 백엔드 셋업 + Bedrock |

---

## 5. 남은 작업

| 우선순위 | 항목 |
|---------|------|
| ✅ 완료 | ~~ai-analyzer 모델 교체~~ → Opus 4.7 확정, E2E 완주 확인 |
| ✅ 완료 | ~~텍스트 PDF 마감일·서류·일정 추출 시연~~ → 검증 완료 |
| 🟡 | 프론트엔드 브라우저 E2E 확인 (로그인 → 업로드 → 분석 표시) |
| 🟢 | 견고성 개선분(`9df6038`) 배포 — 선택 (현재 동작엔 무관) |
| 🟢 | 그룹 C (공지/설정/이메일인증) — 백엔드 신규 API 필요 |
| 🟢 | 스캔 PDF OCR 정확도 (Textract 한글 인식) — Opus 추론으로 일부 보완됨 |

---

## 6. 백엔드 핵심 완성 (2026-05-17)

전체 파이프라인이 프로덕션에서 정상 동작함을 E2E로 확인:
- 업로드 / OCR / DynamoDB Streams / Bedrock(Opus 4.7) / 분석 결과 저장 전 구간
- 며칠간의 권한 이슈(Textract → DynamoDB Streams → bedrock:InvokeModel → 모델 구독) 순차 해결 완료
- 프론트엔드는 분석된 문서 데이터를 실제로 표시 (그룹 A·B 연동 완료)
