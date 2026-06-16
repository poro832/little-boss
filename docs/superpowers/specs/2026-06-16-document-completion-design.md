# 완료된 문서(체크 완료 후 완료 처리) 설계

- 날짜: 2026-06-16
- 대상: `backend/handlers/action_handler.py`, `frontend/api.js`, `frontend/LittleBoss.jsx`
- 상태: 설계 승인됨, 구현 대기

## 목표

문서 분류 기준을 **시간(마감일 경과)** 에서 **사용자 완료 처리**로 바꾼다.
문서의 모든 체크리스트 항목을 체크하면 **완료 버튼**이 활성화되고, 누르면 그 문서가 **완료된 문서**로 이동한다.
기존 "마감된 문서"(마감일 경과 기준) 분류를 "완료된 문서"가 대체한다.

## 배경 / 현재 동작

- **진행 중인 문서**(`OngoingPage`): `status === "done" && !ddayInfo(deadlineDate).isPast` (처리 중 문서도 표시). 체크리스트 토글 + 진행률 표시.
- **마감된 문서**(`ExpiredPage`): `ddayInfo(deadlineDate).isPast` — **마감일 경과**만으로 분류(완료 여부 무관).
- 체크리스트 항목 상태는 이미 백엔드(DynamoDB `documents.checklist`)에 저장됨(`PATCH /checklist/{doc_id}` → action-executor `handle_checklist_update`).

## 결정 사항(브레인스토밍 합의)

1. **완료 상태 저장 위치**: 백엔드 문서 필드(서버 영속 — 기기/새로고침/로그인 무관 유지).
2. **마감 지났지만 미완료 문서**: **진행 중에 유지**(완료 전엔 이동하지 않음). 마감 지난 건 빨간 '마감 지남' 배지로 표시.
3. **체크할 서류가 0건인 문서**: 완료 버튼을 **처음부터 활성**(바로 완료 가능).
4. **되돌리기**: 완료된 문서를 다시 진행 중으로 되돌리는 버튼 **제공**.

## 설계 (A안: 기존 `/checklist` 라우트 재사용)

API Gateway는 경로·메서드별로 특정 Lambda에 연결돼 있어 신규 라우트는 메서드 통합 + per-resource CORS 추가가 필요하다. 이를 피하려고, **이미 연결된 `PATCH /checklist/{doc_id}`**(action-executor) 라우트를 확장한다.

### 데이터 모델

문서 레코드(`sgu-pj-03-documents`)에 두 필드 추가:

| 속성 | 타입 | 설명 |
|---|---|---|
| `completed` | BOOL | 사용자 완료 처리 여부(기본 false/없음) |
| `completed_at` | S | 완료 시각 ISO8601 (되돌리면 제거) |

`status`는 `done` 그대로 유지(폴링 `status==="done"`·분석 파이프라인에 영향 없음).

### 백엔드 (`backend/handlers/action_handler.py`, action-executor 재배포)

라우터의 `PATCH /checklist/{doc_id}` 분기를 다음과 같이 분기 처리:

```python
elif '/checklist/' in path and method == 'PATCH':
    if body.get('name') is None and 'set_completed' in body:
        result = handle_document_completion(doc_id, bool(body.get('set_completed')))
    else:
        result = handle_checklist_update(doc_id, body.get('name'), body.get('completed', False))
```

신규 함수:

```python
def handle_document_completion(doc_id: str, completed: bool) -> dict:
    """문서 완료/되돌리기 토글."""
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": "문서를 찾을 수 없습니다."}
    doc["completed"] = completed
    if completed:
        doc["completed_at"] = datetime.utcnow().isoformat()
    else:
        doc.pop("completed_at", None)
    save_document(doc_id, doc)
    return {"success": True, "doc_id": doc_id, "completed": completed}
```

- `get_document`/`save_document`은 이미 action_handler에서 사용 중(`handle_checklist_update`와 동일 패턴).
- `datetime`은 파일에 import 추가(없으면).

### 프론트 API (`frontend/api.js`)

```js
// 문서 완료/되돌리기 (기존 /checklist 라우트 재사용)
export const setDocumentCompleted = (docId, completed) =>
  api.patch(`/checklist/${docId}`, { set_completed: completed });
```

`toScreenDoc`에 완료 여부 노출:
```js
completed: !!doc.completed,
```

### 프론트 화면 (`frontend/LittleBoss.jsx`)

**진행 중인 문서(`OngoingPage`)**
- 필터를 `done && !completed`로 변경(마감 경과 조건 제거). 처리 중 문서는 기존대로 표시.
  ```js
  const ongoing = docs.filter(d => {
    if (d.status !== "done") return d.status !== "error";
    return !d.completed;
  });
  ```
- 마감 지난 문서도 진행 중에 남으므로, 마감 배지는 기존 색상 로직(과거 날짜 → 빨강) 유지 + 텍스트는 `dd.text`("N일 전").
- 각 카드(분석 완료 상태)에 **완료 버튼** 추가:
  - 활성 조건: `doc.total === 0 || doneCount === doc.total`.
  - 클릭(카드 클릭 전파 방지) → `setDocumentCompleted(doc.doc_id, true)` → 성공 시 `reload()`. 실패 시 toast.

**완료된 문서(`CompletedPage`, 기존 `ExpiredPage` 대체)**
- 필터: `done && completed`(숨김 목록 제외 로직은 기존 유지 가능).
- 헤더 문구: "완료된 문서" / "완료 처리한 문서 목록입니다."
- EmptyState: "완료된 문서가 없습니다" / "체크리스트를 끝내고 완료하면 여기에 모입니다."
- 각 카드에 **되돌리기 버튼** → `setDocumentCompleted(doc.doc_id, false)` → `reload()`. 기존 삭제 버튼 유지.

**사이드바 / 타이틀 (참조 4곳 일괄 변경)**
- `sub-expired` → `sub-completed`
- "🗂️ 마감된 문서" → "✅ 완료된 문서"
- 변경 위치: 사이드바 메뉴 배열(`["sub-schedule",...]`), `isDocsSub` 배열, 렌더 스위치(`sub === "sub-expired"` → `"sub-completed"`), `titleMap`.

**대시보드(`HomePage` 계산)**
- '마감 임박' 카드: 완료 문서 제외 → `.filter(d => d.status === "done" && d.deadlineDate && !ddayInfo(d.deadlineDate).isPast && !d.completed)`.
- 상태 라벨: `const status = d.completed ? "완료" : dd.isPast ? "미완료" : "진행 중";`

## 데이터 흐름

```
[진행 중 카드] 체크 전부 완료 → 완료 버튼 활성
  → 클릭 → PATCH /checklist/{doc_id} {set_completed:true}
  → action-executor: doc.completed=true, completed_at 설정, save
  → reload → 진행 중에서 사라지고 완료된 문서에 등장
[완료된 문서 카드] 되돌리기 → PATCH {set_completed:false} → completed=false → 진행 중 복귀
```

## 에러 처리

- 문서 없음 → `{success:false}` 400(프론트 toast).
- PATCH 실패(네트워크 등) → 프론트 toast, 목록 상태 변화 없음(서버 미반영).
- 완료/되돌리기 버튼은 요청 중 비활성화(중복 클릭 방지)는 선택(낙관적 reload로 충분).

## 비목표 (YAGNI)

- 일정 캘린더 색상(`deadlinesForMonth`/`deadlineEvents`)은 마감 기준 그대로 — 이번 범위 밖.
- 완료 시 별도 알림(메일/Slack) — 범위 밖.
- 완료 일괄 처리/정렬 옵션 — 범위 밖.

## 영향 파일

- `backend/handlers/action_handler.py` — PATCH 분기 + `handle_document_completion`(+`datetime` import)
- `frontend/api.js` — `setDocumentCompleted`, `toScreenDoc.completed`
- `frontend/LittleBoss.jsx` — OngoingPage 필터+완료 버튼, ExpiredPage→CompletedPage, 사이드바/타이틀, 대시보드 필터
- `backend/tests/test_document_completion.py` — 신규

## 테스트

**백엔드**(`backend/tests/`, 기존 컨벤션 — 직접 실행 + `__main__`):
- `PATCH /checklist/{doc_id}` 바디 `{set_completed:true}` → `handle_document_completion` 분기 → 문서 `completed=true`·`completed_at` 저장, `{success:true, completed:true}`.
- `{set_completed:false}` → `completed=false`, `completed_at` 제거.
- 문서 없음 → `{success:false}`.
- 기존 항목 토글(`{name, completed}`)이 분기 변경 후에도 정상 동작(회귀).

**프론트**: 러너 없음 → `npm run build` + 수동(완료 버튼 활성/이동, 되돌리기, 마감 지난 진행중 표시, 사이드바 라벨).

## 배포

- action-executor Lambda 코드 재배포(`sgu-pj-03-action-executor`). API Gateway/CORS 변경 없음.
- 프론트는 GitHub Pages 자동 배포.

## 리스크

- `/checklist` 라우트에 문서 완료 의미를 얹는 것은 약간의 의미 혼합(캡스톤 범위에서 수용). 분기 키 `set_completed`로 기존 항목 토글과 충돌 없음(`name` 유무로 구분).
- 기존 문서엔 `completed` 필드가 없음 → 프론트 `!!doc.completed`로 안전 처리(없으면 false).
