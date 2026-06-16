# Presigned URL 직접 업로드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹 업로드가 API Gateway를 거치지 않고 presigned PUT URL로 S3에 직접 올라가게 해 10MB 한도를 우회한다.

**Architecture:** `POST /upload`를 멀티파트 수신 대신 **presigned PUT URL 발급 + 문서 레코드 생성**으로 교체. 프론트는 받은 URL로 파일을 S3에 직접 PUT한다. Slack/로컬 경로(`process`/`save_file`)와 S3 이벤트 트리거는 그대로.

**Tech Stack:** Python 3.11 Lambda(boto3 s3 presign), React 18 + Vite(axios). 백엔드 테스트는 기존 컨벤션(직접 실행 + `__main__`), 프론트는 `npm run build` + 수동.

---

## File Structure

- `backend/utils/storage.py` — **수정**. `presigned_put_url(s3_key, expires)` 추가(S3 PUT 서명 URL).
- `backend/handlers/upload_handler.py` — **수정**. `_handle_upload`를 presign 발급으로 교체, import 정리.
- `backend/tests/test_upload_presign.py` — **신규**.
- `frontend/api.js` — **수정**. `uploadFile`을 2단계(presign 요청 → S3 직접 PUT) + 50MB 체크로.

Task 1(백엔드) → Task 2(프론트) 순서.

---

### Task 1: 백엔드 — presigned URL 발급

**Files:**
- Modify: `backend/utils/storage.py`, `backend/handlers/upload_handler.py`
- Test: `backend/tests/test_upload_presign.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_upload_presign.py`:

```python
import os, sys, json
os.environ["ENV"] = "local"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from handlers import upload_handler

_saved = {}
upload_handler.save_document = lambda doc_id, data: _saved.__setitem__(doc_id, data)
upload_handler.presigned_put_url = lambda key, **k: f"https://s3.example/{key}?sig=abc"


def _post_upload(body):
    return upload_handler.handle({"path": "/upload", "httpMethod": "POST", "body": json.dumps(body)})


def test_presign_returns_url_and_saves_record():
    _saved.clear()
    resp = _post_upload({"filename": "scholarship.pdf", "user_id": "u@e.com"})
    body = json.loads(resp["body"])
    assert body["success"] is True
    assert body["doc_id"]
    key = f"uploads/{body['doc_id']}/scholarship.pdf"
    assert body["upload_url"] == f"https://s3.example/{key}?sig=abc"
    rec = _saved[body["doc_id"]]
    assert rec["status"] == "uploaded"
    assert rec["file_path"] == key
    assert rec["user_id"] == "u@e.com"
    assert rec["filename"] == "scholarship.pdf"


def test_presign_rejects_bad_extension():
    _saved.clear()
    resp = _post_upload({"filename": "malware.exe", "user_id": "u"})
    assert resp["statusCode"] == 400
    assert json.loads(resp["body"])["success"] is False
    assert _saved == {}


def test_presign_requires_filename():
    _saved.clear()
    resp = _post_upload({"user_id": "u"})
    assert resp["statusCode"] == 400
    assert json.loads(resp["body"])["success"] is False


if __name__ == "__main__":
    test_presign_returns_url_and_saves_record()
    test_presign_rejects_bad_extension()
    test_presign_requires_filename()
    print("OK")
```

- [ ] **Step 2: 실패 확인** — From `backend`: `python tests/test_upload_presign.py`
Expected: FAIL — 기존 `_handle_upload`는 멀티파트라 JSON 바디에서 `file` 필드를 못 찾아 `success=False`("파일이 없습니다") → 첫 assert 실패. (또는 `presigned_put_url` 미존재.)

- [ ] **Step 3: `storage.py`에 presign 헬퍼 추가** — `backend/utils/storage.py`에서 `get_file` 함수 정의 바로 아래에 추가:

```python
def presigned_put_url(s3_key: str, expires: int = 300) -> str:
    """S3 PUT presigned URL 발급 (브라우저가 S3에 직접 업로드)."""
    import boto3
    s3 = boto3.client("s3")
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": os.getenv("S3_BUCKET"), "Key": s3_key},
        ExpiresIn=expires,
    )
```

- [ ] **Step 4: `upload_handler.py` 수정** —

(a) 상단 import 정리. 현재:
```python
import os
import json
import base64
import cgi
import io
from models.document import Document
from utils.storage import save_file, save_document, get_document, list_documents, delete_document
import dataclasses
```
을 다음으로(미사용 `cgi`·`io` 제거, `presigned_put_url` 추가):
```python
import os
import json
import base64
from models.document import Document
from utils.storage import save_file, save_document, get_document, list_documents, delete_document, presigned_put_url
import dataclasses
```

(b) `_handle_upload` 함수 전체를 다음으로 교체:
```python
def _handle_upload(event):
    """presigned PUT URL 발급 + 문서 레코드 생성 (브라우저가 S3에 직접 업로드)."""
    b = _json_body(event)
    filename = (b.get('filename') or '').strip()
    user_id = b.get('user_id') or 'anonymous'
    if not filename:
        return _response(400, {'success': False, 'message': 'filename이 필요합니다.'})

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return _response(400, {'success': False, 'message': f"지원하지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXTENSIONS)})"})

    doc = Document(filename=filename, user_id=user_id, status='uploaded')
    s3_key = f"uploads/{doc.doc_id}/{filename}"
    doc_data = dataclasses.asdict(doc)
    doc_data['file_path'] = s3_key
    save_document(doc.doc_id, doc_data)

    url = presigned_put_url(s3_key)
    return _response(200, {
        'success': True,
        'doc_id': doc.doc_id,
        'upload_url': url,
        'filename': filename,
        'status': 'uploaded',
        'message': 'presigned URL 발급 완료. 이 URL로 파일을 업로드하세요.',
    })
```

> 주의: `process()`와 `save_file()`은 **그대로 둔다**(Slack `slack_handler._ingest`·로컬 `local_server.py`가 사용). 이번엔 웹 `/upload` 경로만 바뀐다.

- [ ] **Step 5: 통과 확인** — From `backend`:
- `python tests/test_upload_presign.py` → `OK`
- import 스모크(미사용 import 제거 후 정상): `python -c "import sys; sys.path.insert(0,'.'); from handlers import upload_handler; print('IMPORT OK', hasattr(upload_handler,'process'))"` → `IMPORT OK True`
- 회귀: `python tests/test_notify_hooks.py` → `OK`

- [ ] **Step 6: 커밋**
```bash
git add backend/utils/storage.py backend/handlers/upload_handler.py backend/tests/test_upload_presign.py
git commit -m "feat(upload): 웹 업로드를 presigned PUT 발급으로 교체(API Gateway 10MB 우회)"
```

---

### Task 2: 프론트 — uploadFile 2단계 + 50MB 체크

**Files:**
- Modify: `frontend/api.js`

- [ ] **Step 1: `uploadFile` 교체** — `frontend/api.js`의 현재 `uploadFile`:
```js
// 파일 업로드 → { success, doc_id, status, ... }
export const uploadFile = (file, userId) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("user_id", userId || "anonymous");
  return api.post("/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
```
을 다음으로 교체:
```js
// 파일 업로드: ① presigned URL 발급 → ② S3에 직접 PUT (API Gateway 10MB 우회)
export const uploadFile = async (file, userId) => {
  if (file.size > 50 * 1024 * 1024) throw new Error("파일이 너무 큽니다 (최대 50MB)");
  const { data } = await api.post("/upload", { filename: file.name, user_id: userId || "anonymous" });
  if (!data || !data.success || !data.upload_url) return { data };  // 실패는 호출부가 data.success로 처리
  await axios.put(data.upload_url, file, { headers: { "Content-Type": file.type || "application/octet-stream" } });
  return { data };
};
```

(`axios`는 파일 상단에서 이미 import됨. S3 PUT은 절대 URL이라 `api`(baseURL) 대신 순수 `axios` 사용. 반환은 `{ data }` 유지 → 호출부 `UploadPage.addFiles`의 `const { data } = await uploadFile(...)` + `data.success`/`data.doc_id` 폴링 흐름 그대로.)

- [ ] **Step 2: 빌드 확인** — Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: 변경 확인** — Run (from `frontend`):
```bash
node -e "const s=require('fs').readFileSync('api.js','utf8'); console.log('presign 2단계:', s.includes('axios.put(data.upload_url') && s.includes('filename: file.name')); console.log('multipart 제거:', !s.includes('multipart/form-data'))"
```
Expected: 두 줄 모두 `true`.

- [ ] **Step 4: 커밋**
```bash
git add frontend/api.js
git commit -m "feat(upload): uploadFile을 presigned URL 2단계 업로드 + 50MB 체크로"
```

---

### Task 3: 수동 검증 체크리스트

**Files:** 없음(검증 전용).

- [ ] **Step 1: 빌드 최종 확인** — `cd frontend && npm run build` → 성공.

- [ ] **Step 2: (배포 후) 수동 시나리오**
1. 웹 로그인 → 문서 업로드 → 정상 분석(소형 파일).
2. 브라우저 DevTools Network: `POST /upload`가 **JSON 응답(upload_url 포함)** 이고, 이어서 **S3 도메인으로 PUT 200**이 보이는지(= API Gateway 우회 확인).
3. **10MB 초과(예: 15MB) 파일** 업로드 → 이전엔 실패했지만 이번엔 성공하는지.
4. **50MB 초과** 파일 → "파일이 너무 큽니다 (최대 50MB)" 에러.
5. Slack 업로드(별도 경로)도 여전히 정상인지(회귀 확인).

- [ ] **Step 3: 결과 기록** — 실패 항목 있으면 해당 Task로 복귀.

---

## Self-Review

**1. Spec coverage**
- presigned PUT URL 발급 + 레코드 생성 → Task 1 (storage.presigned_put_url + _handle_upload). ✓
- 확장자 검증 / filename 필수 → Task 1 _handle_upload + 테스트. ✓
- process/save_file 유지(Slack·로컬) → Task 1에서 미변경 명시. ✓
- S3 이벤트 트리거 그대로(uploads/{doc_id}/{filename}) → 키 동일 유지로 충족. ✓
- 프론트 2단계 + 50MB + axios PUT → Task 2. ✓
- 반환형 `{ data }` 유지(addFiles 흐름 불변) → Task 2. ✓
- 백엔드 테스트(발급/잘못된 확장자/filename 없음) → Task 1 테스트. ✓
- 프론트 빌드+수동 → Task 2/3. ✓

**2. Placeholder scan:** 모든 코드 단계 실제 코드. TBD/TODO 없음. ✓

**3. Type/이름 일관성:** `presigned_put_url(s3_key, expires)` 정의(storage)·import(upload_handler)·monkeypatch(test)·호출(`presigned_put_url(s3_key)`) 일치. 응답 키 `doc_id`·`upload_url`·`success`(백엔드)↔프론트 `data.doc_id`·`data.upload_url`·`data.success` 일치. S3 key `uploads/{doc_id}/{filename}` 형식 일관(기존 트리거와 동일). `ALLOWED_EXTENSIONS`·`Document`·`_json_body`·`_response`는 upload_handler 기존 심볼. ✓
