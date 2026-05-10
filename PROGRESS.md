# LittleBoss 진행 현황

> 최종 업데이트: 2026-03-10

---

## 완료된 작업

### 1. 기획 문서
- `PROJECT_PLAN.md` - 전체 프로젝트 계획서 (기술스택, 아키텍처, 로드맵, 스키마, 비용)
- `PPT_GUIDE.md` - 주제 발표 PPT 구성 가이드
- `ROADMAP.md` - AWS 계정 수령 후 단계별 개발 로드맵
- `DB_DIAGRAM.md` - DB ER 다이어그램 및 테이블 스키마 (로컬/AWS 양쪽) ← 오늘 작성

### 2. 백엔드 베이스 구조 (`backend/`)
- `models/document.py` - 데이터 모델 (Document, Deadline, RequiredDocument, CalendarEvent, AnalysisResult)
- `utils/storage.py` - 스토리지 레이어 (로컬 JSON ↔ AWS S3/DynamoDB 전환 가능)
- `utils/ocr.py` - OCR 레이어 (로컬 PyMuPDF ↔ Amazon Textract 전환 가능)
- `utils/ai.py` - AI 분석 레이어 (Gemini `gemini-2.0-flash` ↔ Claude Haiku 전환 가능)
- `handlers/upload_handler.py` - 파일 업로드 처리
- `handlers/ocr_handler.py` - OCR 처리
- `handlers/ai_handler.py` - AI 분석 처리
- `handlers/action_handler.py` - 캘린더 등록 / 체크리스트 처리
- `local_server.py` - Flask 로컬 테스트 서버 (포트 5000)
- `tests/test_pipeline.py` - 파이프라인 구조 테스트 (Windows cp949 이모지 오류 수정 완료)
- `requirements.txt` - 의존성 패키지
- `.env` - 환경변수

### 3. 프론트엔드 (`frontend/`)
- React 프로젝트 생성 완료
- `axios`, `react-dropzone`, `react-router-dom` 패키지 설치 완료

### 4. 로컬 환경 검증 (오늘 완료)
- Flask 서버 정상 실행 확인 (localhost:5000)
- `/health` 엔드포인트 정상 응답
- 파이프라인 구조 테스트 통과
- 실제 PDF 업로드 → **OCR 텍스트 추출 성공** (3,323자)
- 업로드 ~ OCR 까지 전체 흐름 정상 작동 확인

---

## 주요 기술 결정사항

| 항목 | 결정 | 이유 |
|------|------|------|
| AI 모델 | Gemini `gemini-2.0-flash` (기본) / Claude Haiku (선택) | 추후 전환 가능 구조 |
| LLM 호출 방식 | Lambda에서 Gemini API 직접 호출 | 외부 API 직접 호출 방식 |
| 로컬 스토리지 | JSON 파일 (`backend/local_db/`) | AWS 없이 개발 가능하도록 |
| 로컬 OCR | PyMuPDF | AWS Textract 대체 |
| 프론트엔드 | React (웹) → React Native (앱, 발표 이후) | 백엔드 API 재사용 가능 |

---

## 백엔드 전체 흐름

```
파일 업로드
    → upload_handler  (S3 또는 로컬 저장)
    → ocr_handler     (Textract 또는 PyMuPDF)
    → ai_handler      (Gemini 또는 Claude)
    → action_handler  (캘린더 등록 + 체크리스트 저장)
```

---

## API 엔드포인트 (로컬 서버 기준)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/upload` | 파일 업로드 |
| POST | `/ocr/{doc_id}` | OCR 처리 |
| POST | `/analyze/{doc_id}` | AI 분석 |
| POST | `/process` | 업로드~분석 한번에 |
| GET | `/documents` | 문서 목록 |
| GET | `/documents/{doc_id}` | 문서 상세 |
| POST | `/calendar/{doc_id}` | 캘린더 등록 |
| GET | `/checklist/{doc_id}` | 체크리스트 조회 |
| PATCH | `/checklist/{doc_id}` | 체크리스트 업데이트 |
| GET | `/health` | 서버 상태 확인 |

---

## 알려진 이슈

| 이슈 | 상태 | 내용 |
|------|------|------|
| Gemini API 쿼터 | **미해결** | 개인/학교 Gmail 모두 `limit: 0` — free tier 자체가 막혀있는 상태. Google AI Studio에서 키 재발급 필요 |
| Windows 한글 경로 | 해결됨 | 파일 업로드 시 `/tmp/` 경로 사용으로 우회 |
| 이모지 인코딩 (cp949) | 해결됨 | `test_pipeline.py` 이모지 제거 |

---

## 다음 할 일

### 최우선 (다음 세션 시작 시)
- [ ] **Gemini API 키 발급** → `.env`에 `GEMINI_API_KEY` 입력, `AI_PROVIDER=gemini` 확인
- [ ] AI 분석 전체 파이프라인 테스트 (업로드 → OCR → AI 분석 → 결과 확인)
- [ ] 캘린더/체크리스트 API 엔드포인트 테스트

### 이후
- [ ] React 프론트엔드 UI 개발
  - [ ] 파일 업로드 화면 (드래그앤드롭)
  - [ ] 분석 중 로딩 화면
  - [ ] 결과 화면 (마감일 카드 + 체크리스트)
  - [ ] 문서 목록 화면
- [ ] 백엔드 API 연동 (axios)
- [ ] Google OAuth 로그인 구현
- [ ] AWS 계정 수령 후 storage.py, ocr.py 주석 해제하여 AWS 전환
