# 완료된 문서(체크 완료 후 완료 처리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서 분류를 마감일 경과 기준에서 사용자 완료 처리 기준으로 바꿔, 체크리스트를 끝내고 "완료" 버튼을 누르면 문서가 "완료된 문서"로 이동하게 한다(되돌리기 포함).

**Architecture:** 백엔드는 문서 레코드에 `completed`/`completed_at` 필드를 두고, 이미 연결된 `PATCH /checklist/{doc_id}`(action-executor) 라우트를 `set_completed` 바디로 확장해 토글한다(API Gateway/CORS 변경 0). 프론트는 진행 중 카드에 완료 버튼을, 완료된 문서 페이지에 되돌리기 버튼을 추가하고 분류 필터를 완료 기준으로 바꾼다.

**Tech Stack:** Python 3.11 Lambda(stdlib), React 18 + Vite. 백엔드 테스트는 기존 컨벤션(직접 실행 + `__main__`), 프론트는 `npm run build` + 수동.

---

## File Structure

- `backend/handlers/action_handler.py` — **수정**. PATCH 분기에 문서 완료 토글 추가 + `handle_document_completion` + `datetime` import.
- `backend/tests/test_document_completion.py` — **신규**.
- `frontend/api.js` — **수정**. `setDocumentCompleted` 추가, `toScreenDoc`에 `completed` 노출.
- `frontend/LittleBoss.jsx` — **수정**. import에 `setDocumentCompleted`; OngoingPage 필터+완료 버튼; ExpiredPage→CompletedPage(되돌리기); 사이드바/타이틀 라벨; 대시보드 필터.

Task 1(백엔드) → Task 2(프론트 api) → Task 3(프론트 화면) → Task 4(검증/배포).

---

### Task 1: 백엔드 — 문서 완료 토글

**Files:**
- Modify: `backend/handlers/action_handler.py`
- Test: `backend/tests/test_document_completion.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_document_completion.py`:

```python
import os, sys, json
os.environ["ENV"] = "local"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from handlers import action_handler

_store = {}
action_handler.get_document = lambda doc_id: _store.get(doc_id)
action_handler.save_document = lambda doc_id, data: _store.__setitem__(doc_id, data)


def _patch(doc_id, body):
    return action_handler.handle({
        "path": f"/checklist/{doc_id}", "httpMethod": "PATCH",
        "pathParameters": {"doc_id": doc_id}, "body": json.dumps(body),
    })


def test_set_completed_true():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done", "completed": False}
    resp = _patch("d1", {"set_completed": True})
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 200
    assert body["success"] is True
    assert body["completed"] is True
    assert _store["d1"]["completed"] is True
    assert _store["d1"].get("completed_at")  # 완료 시각 기록


def test_set_completed_false_removes_timestamp():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done", "completed": True, "completed_at": "2026-06-16T00:00:00"}
    resp = _patch("d1", {"set_completed": False})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert _store["d1"]["completed"] is False
    assert "completed_at" not in _store["d1"]


def test_completion_doc_not_found():
    _store.clear()
    resp = _patch("missing", {"set_completed": True})
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 400
    assert body["success"] is False


def test_checklist_item_toggle_still_works():
    _store.clear()
    _store["d1"] = {"doc_id": "d1", "status": "done",
                    "checklist": [{"name": "성적증명서", "description": "", "completed": False}]}
    resp = _patch("d1", {"name": "성적증명서", "completed": True})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert _store["d1"]["checklist"][0]["completed"] is True


if __name__ == "__main__":
    test_set_completed_true()
    test_set_completed_false_removes_timestamp()
    test_completion_doc_not_found()
    test_checklist_item_toggle_still_works()
    print("OK")
```

- [ ] **Step 2: 실패 확인** — From `backend`: `python tests/test_document_completion.py`
Expected: FAIL — 현재 `set_completed` 분기가 없어 `handle_checklist_update(doc_id, None, False)`로 빠지고, `completed` 필드가 기록되지 않아 첫 테스트 assert 실패.

- [ ] **Step 3: import 추가** — `backend/handlers/action_handler.py` 상단 import 블록:
```python
import os
import json
from utils.storage import get_document, save_document
```
을 다음으로(`datetime` 추가):
```python
import os
import json
from datetime import datetime
from utils.storage import get_document, save_document
```

- [ ] **Step 4: PATCH 분기 확장** — 같은 파일 `handle()`의 다음 줄:
```python
    elif '/checklist/' in path and method == 'PATCH':
        result = handle_checklist_update(doc_id, body.get('name'), body.get('completed', False))
```
을 다음으로 교체:
```python
    elif '/checklist/' in path and method == 'PATCH':
        if body.get('name') is None and 'set_completed' in body:
            result = handle_document_completion(doc_id, bool(body.get('set_completed')))
        else:
            result = handle_checklist_update(doc_id, body.get('name'), body.get('completed', False))
```

- [ ] **Step 5: `handle_document_completion` 추가** — 같은 파일에서 `handle_checklist_update` 함수 정의 바로 위(또는 아래)에 추가:
```python
def handle_document_completion(doc_id: str, completed: bool) -> dict:
    """문서 완료/되돌리기 토글 (체크리스트 항목 토글과 별개)."""
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

- [ ] **Step 6: 통과 확인** — From `backend`:
- `python tests/test_document_completion.py` → `OK`
- 회귀: `python tests/test_upload_presign.py` → `OK` (다른 핸들러 영향 없음 확인)

- [ ] **Step 7: 커밋**
```bash
git add backend/handlers/action_handler.py backend/tests/test_document_completion.py
git commit -m "feat(action): 문서 완료/되돌리기 토글(PATCH /checklist set_completed 분기)"
```

---

### Task 2: 프론트 API — setDocumentCompleted + completed 노출

**Files:**
- Modify: `frontend/api.js`

- [ ] **Step 1: `setDocumentCompleted` 추가** — `frontend/api.js`에서 기존 체크리스트 API 바로 아래:
```js
// 체크리스트
export const getChecklist = (docId) => api.get(`/checklist/${docId}`);
export const updateChecklistItem = (docId, name, completed) =>
  api.patch(`/checklist/${docId}`, { name, completed });
```
다음 줄을 그 아래에 추가:
```js
// 문서 완료/되돌리기 (기존 /checklist 라우트 재사용 — name 없이 set_completed)
export const setDocumentCompleted = (docId, completed) =>
  api.patch(`/checklist/${docId}`, { set_completed: completed });
```

- [ ] **Step 2: `toScreenDoc`에 completed 노출** — 같은 파일 `toScreenDoc`의 반환 객체에서:
```js
    status: doc.status,
```
바로 아래 줄에 추가:
```js
    completed: !!doc.completed,
```

- [ ] **Step 3: 변경 확인** — From `frontend`:
```bash
node -e "const s=require('fs').readFileSync('api.js','utf8'); console.log('setDocumentCompleted:', s.includes('set_completed: completed')); console.log('completed 노출:', s.includes('completed: !!doc.completed'))"
```
Expected: 두 줄 모두 `true`.

- [ ] **Step 4: 커밋**
```bash
git add frontend/api.js
git commit -m "feat(web): setDocumentCompleted API + toScreenDoc.completed 노출"
```

---

### Task 3: 프론트 화면 — 완료 버튼·완료된 문서 페이지·라벨

**Files:**
- Modify: `frontend/LittleBoss.jsx`

- [ ] **Step 1: import에 setDocumentCompleted 추가** — 4번째 줄 import에서 `updateChecklistItem,` 뒤에 `setDocumentCompleted,`를 추가. 현재:
```js
import { uploadFile, pollUntilDone, registerCalendar, useDocuments, ddayInfo, updateChecklistItem, deadlinesForMonth, deadlineEvents, signup as apiSignup, emailLogin as apiEmailLogin, deleteDocument, updateProfile, changePassword, updateNotifSettings, deleteAccount, requestReset, verifyReset, confirmReset } from "./api";
```
교체:
```js
import { uploadFile, pollUntilDone, registerCalendar, useDocuments, ddayInfo, updateChecklistItem, setDocumentCompleted, deadlinesForMonth, deadlineEvents, signup as apiSignup, emailLogin as apiEmailLogin, deleteDocument, updateProfile, changePassword, updateNotifSettings, deleteAccount, requestReset, verifyReset, confirmReset } from "./api";
```

- [ ] **Step 2: 대시보드 완료 반영** — `HomePage`(또는 Dashboard) 계산부. 현재:
```js
      const status = allDone ? "완료" : dd.isPast ? "미완료" : "진행 중";
```
교체:
```js
      const status = d.completed ? "완료" : allDone ? "완료" : dd.isPast ? "미완료" : "진행 중";
```
그리고 '마감 임박' 필터. 현재:
```js
  const urgentDoc = serverDocs
    .filter(d => d.status === "done" && d.deadlineDate && !ddayInfo(d.deadlineDate).isPast)
```
교체:
```js
  const urgentDoc = serverDocs
    .filter(d => d.status === "done" && d.deadlineDate && !ddayInfo(d.deadlineDate).isPast && !d.completed)
```

- [ ] **Step 3: OngoingPage 상태/핸들러 추가** — `OngoingPage` 함수 안, 기존 `const [deletingId, setDeletingId] = useState(null);` 아래에 추가:
```js
  const [completingId, setCompletingId] = useState(null);
  const handleComplete = async (docId) => {
    setCompletingId(docId);
    try {
      const { data } = await setDocumentCompleted(docId, true);
      if (!data.success) throw new Error(data.message || "완료 처리 실패");
      reload?.();
    } catch (e) {
      toast("완료 처리 실패: " + (e.response?.data?.message || e.message));
    } finally {
      setCompletingId(null);
    }
  };
```

- [ ] **Step 4: OngoingPage 필터 변경(완료 기준)** — `OngoingPage`의 ongoing 필터. 현재:
```js
  // 진행 중 = 분석 완료(done) & 마감 안 지남
  const ongoing = docs.filter(d => {
    if (d.status !== "done") return d.status !== "error"; // 처리중 문서도 표시
    const dd = ddayInfo(d.deadlineDate);
    return !dd.isPast;
  });
```
교체:
```js
  // 진행 중 = 분석 완료(done) & 아직 완료 처리 안 함 (마감 지나도 완료 전엔 진행 중에 유지)
  const ongoing = docs.filter(d => {
    if (d.status !== "done") return d.status !== "error"; // 처리중 문서도 표시
    return !d.completed;
  });
```

- [ ] **Step 5: OngoingPage 완료 버튼 추가** — 카드 내 진행률 블록. 현재:
```jsx
                  <div style={{ height: 5, background: C.track, borderRadius: 3, marginTop: 14 }}><div style={{ height: "100%", borderRadius: 3, background: C.purple, width: percentage+"%" }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textLight, marginTop: 5 }}>
                    <span>서류 준비 현황</span><span style={{ color: C.purple, fontWeight: 600 }}>{doneCount} / {doc.total} 완료</span>
                  </div>
                </>
```
교체(진행률 블록 아래에 완료 버튼 추가):
```jsx
                  <div style={{ height: 5, background: C.track, borderRadius: 3, marginTop: 14 }}><div style={{ height: "100%", borderRadius: 3, background: C.purple, width: percentage+"%" }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textLight, marginTop: 5 }}>
                    <span>서류 준비 현황</span><span style={{ color: C.purple, fontWeight: 600 }}>{doneCount} / {doc.total} 완료</span>
                  </div>
                  {(() => {
                    const canComplete = doc.total === 0 || doneCount === doc.total;
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleComplete(doc.doc_id); }}
                        disabled={!canComplete || completingId === doc.doc_id}
                        style={{ ...S.btnPrimary, marginTop: 14, width: "100%", fontSize: 13, opacity: canComplete ? 1 : 0.45, cursor: canComplete ? "pointer" : "not-allowed" }}
                      >
                        {completingId === doc.doc_id ? "완료 처리 중..." : (canComplete ? "✅ 완료 처리" : "서류를 모두 체크하면 완료할 수 있어요")}
                      </button>
                    );
                  })()}
                </>
```

- [ ] **Step 6: ExpiredPage → CompletedPage 함수명·필터** — `function ExpiredPage({ onNavTo, toast }) {`를 `function CompletedPage({ onNavTo, toast }) {`로 변경. 그 안의 필터. 현재:
```js
  // 마감 지난 문서만
  const docs = allDocs.filter(d => {
    if (hidden.includes(d.doc_id)) return false;
    const dd = ddayInfo(d.deadlineDate);
    return dd.isPast;
  });
```
교체:
```js
  // 완료 처리한 문서만
  const docs = allDocs.filter(d => {
    if (hidden.includes(d.doc_id)) return false;
    return d.status === "done" && d.completed;
  });
```

- [ ] **Step 7: CompletedPage 되돌리기 상태/핸들러** — `CompletedPage` 함수 안, 기존 `const [deleting, setDeleting] = useState(false);` 아래에 추가:
```js
  const [reopeningId, setReopeningId] = useState(null);
  const handleReopen = async (docId) => {
    setReopeningId(docId);
    try {
      const { data } = await setDocumentCompleted(docId, false);
      if (!data.success) throw new Error(data.message || "되돌리기 실패");
      reload?.();
    } catch (e) {
      toast("되돌리기 실패: " + (e.response?.data?.message || e.message));
    } finally {
      setReopeningId(null);
    }
  };
```

- [ ] **Step 8: CompletedPage 헤더·EmptyState·배지·되돌리기 버튼** —

(a) 헤더. 현재:
```jsx
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>마감된 문서</div><div style={{ fontSize: 14, color: C.textLight }}>마감이 지난 문서 목록입니다.</div></div>
```
교체:
```jsx
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>완료된 문서</div><div style={{ fontSize: 14, color: C.textLight }}>완료 처리한 문서 목록입니다.</div></div>
```

(b) EmptyState. 현재:
```jsx
        <EmptyState icon="🗂️" title="마감된 문서가 없습니다" desc="마감일이 지난 문서가 여기에 모입니다." />
```
교체:
```jsx
        <EmptyState icon="✅" title="완료된 문서가 없습니다" desc="체크리스트를 끝내고 완료하면 여기에 모입니다." />
```

(c) 상태 배지(고정 완료) + 되돌리기 버튼. 현재:
```jsx
                <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: allDone ? "#F0FDF4" : "#FFE5E5", color: allDone ? C.green : C.red }}>
                  {allDone ? '완료' : '미완료'}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textLight }}>{doc.deadlineDate || "마감일 미상"}</span>
                  <button onClick={() => handleDeleteClick(doc.doc_id)} style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px", color: C.red, borderColor: C.red }}>🗑️ 삭제</button>
                </div>
```
교체:
```jsx
                <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: "#F0FDF4", color: C.green }}>
                  완료
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textLight }}>{doc.deadlineDate || "마감일 미상"}</span>
                  <button onClick={() => handleReopen(doc.doc_id)} disabled={reopeningId === doc.doc_id} style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px" }}>{reopeningId === doc.doc_id ? "처리 중..." : "↩ 되돌리기"}</button>
                  <button onClick={() => handleDeleteClick(doc.doc_id)} style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px", color: C.red, borderColor: C.red }}>🗑️ 삭제</button>
                </div>
```

- [ ] **Step 9: 사이드바·타이틀·렌더 스위치 라벨 변경(sub-expired → sub-completed)** —

(a) `isDocsSub`. 현재:
```js
  const isDocsSub = ["sub-schedule","sub-ongoing","sub-expired"].includes(currentSub);
```
교체:
```js
  const isDocsSub = ["sub-schedule","sub-ongoing","sub-completed"].includes(currentSub);
```

(b) 사이드바 메뉴 배열. 현재:
```jsx
          {[["sub-schedule","📅","일정 관리"],["sub-ongoing","📋","진행 중인 문서"],["sub-expired","🗂️","마감된 문서"]].map(([id,icon,label]) => (
```
교체:
```jsx
          {[["sub-schedule","📅","일정 관리"],["sub-ongoing","📋","진행 중인 문서"],["sub-completed","✅","완료된 문서"]].map(([id,icon,label]) => (
```

(c) `titleMap`. 현재:
```js
  const titleMap = { "sub-home":"대시보드","sub-upload":"문서 업로드","sub-schedule":"일정 관리","sub-ongoing":"진행 중인 문서","sub-expired":"마감된 문서","sub-profile":"내 정보", "schedule-detail":"일정 상세", "doc-detail":"문서 상세" };
```
교체:
```js
  const titleMap = { "sub-home":"대시보드","sub-upload":"문서 업로드","sub-schedule":"일정 관리","sub-ongoing":"진행 중인 문서","sub-completed":"완료된 문서","sub-profile":"내 정보", "schedule-detail":"일정 상세", "doc-detail":"문서 상세" };
```

(d) 렌더 스위치. 현재:
```jsx
          {sub === "sub-expired" && <ExpiredPage onNavTo={navTo} toast={toast} />}
```
교체:
```jsx
          {sub === "sub-completed" && <CompletedPage onNavTo={navTo} toast={toast} />}
```

- [ ] **Step 10: 빌드 확인** — Run: `cd frontend && npm run build`
Expected: 빌드 성공(`✓ built`). 잔존 참조 확인:
```bash
node -e "const s=require('fs').readFileSync('LittleBoss.jsx','utf8'); console.log('sub-expired 잔존:', s.includes('sub-expired')); console.log('ExpiredPage 잔존:', /ExpiredPage/.test(s)); console.log('CompletedPage 정의:', s.includes('function CompletedPage'));"
```
Expected: `sub-expired 잔존: false`, `ExpiredPage 잔존: false`, `CompletedPage 정의: true`.

- [ ] **Step 11: 커밋**
```bash
git add frontend/LittleBoss.jsx
git commit -m "feat(web): 완료 버튼·완료된 문서 페이지(되돌리기)·사이드바 라벨 전환"
```

---

### Task 4: 검증 + 배포 안내

**Files:** 없음(검증/배포 전용).

- [ ] **Step 1: 전체 테스트·빌드 최종 확인**
- `cd backend && python tests/test_document_completion.py` → `OK`
- `cd frontend && npm run build` → 성공

- [ ] **Step 2: 배포 안내 정리** — action-executor Lambda 재배포(코드 변경). API Gateway/CORS 변경 없음. CloudShell:
```bash
cd ~ ; rm -rf little-boss ; git clone https://github.com/poro832/little-boss.git ; cd little-boss/backend ; zip -r /tmp/backend-code.zip handlers models utils -x '*__pycache__*' '*.pyc' ; aws lambda update-function-code --function-name sgu-pj-03-action-executor --zip-file fileb:///tmp/backend-code.zip --region ap-northeast-2
```
프론트는 GitHub Pages 자동 배포.

- [ ] **Step 3: (배포 후) 수동 시나리오**
1. 진행 중 문서: 서류 일부만 체크 → 완료 버튼 비활성("서류를 모두 체크하면…").
2. 전부 체크 → 완료 버튼 활성 → 클릭 → 진행 중에서 사라지고 "완료된 문서"에 등장.
3. 서류 0건 문서 → 완료 버튼 처음부터 활성 → 완료 가능.
4. 완료된 문서 → "↩ 되돌리기" → 진행 중으로 복귀.
5. 마감일이 지난 미완료 문서가 "진행 중"에 남아 있고 마감 배지가 빨갛게 보이는지.
6. 사이드바/상단 라벨이 "완료된 문서"로 표기되는지.

---

## Self-Review

**1. Spec coverage**
- 완료 필드(`completed`/`completed_at`) → Task 1 `handle_document_completion`. ✓
- `/checklist` 라우트 재사용·분기(`set_completed`, name 유무) → Task 1 Step 4. ✓
- `setDocumentCompleted` API + `completed` 노출 → Task 2. ✓
- 진행 중 필터(완료 기준, 마감 지나도 유지) → Task 3 Step 4. ✓
- 완료 버튼(서류 0건 즉시 활성, 전부 체크 시 활성) → Task 3 Step 5. ✓
- 완료된 문서 페이지(필터·헤더·EmptyState·되돌리기) → Task 3 Step 6~8. ✓
- 사이드바/타이틀/스위치 라벨 전환 → Task 3 Step 9. ✓
- 대시보드 완료 제외/라벨 → Task 3 Step 2. ✓
- 기존 항목 토글 회귀 → Task 1 테스트 `test_checklist_item_toggle_still_works`. ✓
- 배포(action-executor) → Task 4 Step 2. ✓

**2. Placeholder scan:** 모든 코드 단계 실제 코드. TBD/TODO 없음. ✓

**3. Type/이름 일관성:** `set_completed`(프론트 바디)↔`body.get('set_completed')`(백엔드 분기)↔`handle_document_completion(doc_id, completed)` 일치. 응답 키 `success`/`completed`(백엔드)↔프론트 `data.success` 일치. `setDocumentCompleted`(api.js 정의·LittleBoss import·OngoingPage/CompletedPage 호출) 일치. `completed: !!doc.completed`(toScreenDoc)↔`d.completed`(필터/대시보드) 일치. `sub-completed`(isDocsSub·메뉴배열·titleMap·스위치) 4곳 일관. `CompletedPage`(정의·스위치) 일치. ✓
