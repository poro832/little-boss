# Presigned URL 직접 업로드 설계

- 날짜: 2026-06-09
- 대상: `backend/handlers/upload_handler.py`, `backend/utils/storage.py`, `frontend/api.js`, `frontend/LittleBoss.jsx`
- 상태: 설계 승인됨, 구현 대기

## 목표

웹 업로드가 **API Gateway를 거치지 않고 S3에 직접 PUT**하도록 바꿔 **10MB 페이로드 한도를 우회**한다.
브라우저는 백엔드에서 받은 **presigned PUT URL**로 파일을 S3에 직접 올린다.

## 배경 / 현재 한계

- 현재 웹 업로드: 프론트가 `multipart/form-data`로 `POST /upload` → Lambda(`_handle_upload`)가 파일
  바이트를 받아 `process()` → S3에 저장. **파일이 API Gateway·Lambda를 통과**하므로 **API Gateway 페이로드
  한도(~10MB)** 에 막힌다(코드의 20MB 제한은 도달 불가).
- S3 버킷 CORS는 **이미 `AllowedOrigins: ["*"]` + `PUT`/`POST`/`GET` + `AllowedHeaders: ["*"]`** 로
  설정돼 있어(2026-06-09 확인), 브라우저 직접 PUT이 **추가 설정 없이 허용**된다.

## 설계 (가안: presigned PUT + 클라이언트 소프트 크기 체크, 최대 50MB)

### 흐름

```
1) [프론트] POST /upload  {filename, user_id}            (JSON, 작은 요청)
2) [upload-handler] 확장자 검증 → doc_id(uuid) 생성
                    → presigned PUT URL 발급(만료 300s)
                    → DynamoDB 레코드 저장(status="uploaded", file_path=s3_key)
                    → {success, doc_id, upload_url, filename, status} 반환
3) [프론트] upload_url 로 파일을 S3에 직접 PUT          ← API Gateway 우회(최대 5GB까지 S3 허용)
4) [S3 ObjectCreated 이벤트] uploads/{doc_id}/{filename} → OCR Lambda 자동 트리거 (기존과 동일)
5) [프론트] /documents/{doc_id} 폴링                     (기존과 동일)
```

### 백엔드

**`backend/utils/storage.py`** — 신규 헬퍼:
```python
def presigned_put_url(s3_key: str, expires: int = 300) -> str:
    """S3 PUT presigned URL 발급(브라우저 직접 업로드용)."""
    import boto3
    s3 = boto3.client("s3")
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": os.getenv("S3_BUCKET"), "Key": s3_key},
        ExpiresIn=expires,
    )
```
(ContentType은 서명에 포함하지 않음 → 브라우저가 어떤 Content-Type으로 PUT해도 무방. OCR은 확장자로 분기.)

**`backend/handlers/upload_handler.py`** — `_handle_upload(event)`를 멀티파트 파싱 대신 **presign 발급**으로 교체:
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
        'success': True, 'doc_id': doc.doc_id, 'upload_url': url,
        'filename': filename, 'status': 'uploaded',
        'message': 'presigned URL 발급 완료. 이 URL로 파일을 업로드하세요.',
    })
```
- import에 `from utils.storage import ... , presigned_put_url` 추가.
- **`process()`·`save_file()`는 그대로 유지** — Slack 경로(`slack_handler._ingest`)와 로컬 개발 서버
  (`local_server.py`)가 계속 사용한다. 즉 이번 변경은 **웹 `/upload` 라우트만** 바꾼다.

### 프론트

**`frontend/api.js`** — `uploadFile`을 2단계로:
```js
export const uploadFile = async (file, userId) => {
  if (file.size > 50 * 1024 * 1024) throw new Error("파일이 너무 큽니다 (최대 50MB)");
  // 1) presigned URL 요청
  const { data } = await api.post("/upload", { filename: file.name, user_id: userId || "anonymous" });
  if (!data || !data.success || !data.upload_url) return { data };  // 실패는 호출부가 data.success로 처리
  // 2) S3에 직접 PUT (API Gateway 우회)
  await axios.put(data.upload_url, file, { headers: { "Content-Type": file.type || "application/octet-stream" } });
  return { data };
};
```
- 반환 형태 `{ data }` 유지 → 호출부(`UploadPage.addFiles`)의 `const { data } = await uploadFile(...)` + `data.success`/`data.doc_id` 폴링 흐름 그대로.
- 50MB 초과는 throw → `addFiles`의 `try/catch`가 `setErrMsg`로 처리(기존).
- `axios`는 이미 import됨. S3 PUT은 절대 URL이라 `api`(baseURL) 대신 순수 `axios` 사용.

`UploadPage.addFiles`는 변경 없음(이미 `uploadFile` → `pollUntilDone` 구조).

## 비목표 (YAGNI)

- 서버측 강제 크기 제한(presigned POST + content-length-range) — (가) 채택, 클라이언트 소프트 체크만.
- Slack/로컬 업로드 경로 변경 — 그대로 둠(서버가 바이트 수신 후 직접 저장).
- 미완료 PUT로 생기는 고아 레코드(status=uploaded, S3 객체 없음) 정리 — 수용(향후 TTL/정리 별도).
- S3 버킷 CORS 변경 — 이미 `*`+PUT 허용이라 불필요.

## 에러 처리

- presign 발급 실패/예외 → 500 응답(호출부 `data.success`로 처리).
- 50MB 초과 → 프론트에서 즉시 throw(서버 호출 안 함).
- S3 PUT 실패(네트워크/만료) → `axios.put`이 reject → `addFiles` catch가 에러 표시.

## 데이터/트리거 정합성

- presigned PUT도 `uploads/{doc_id}/{filename}`에 쓰므로 **기존 S3 ObjectCreated → OCR 트리거 그대로**. 설정 변경 0.
- 문서 레코드를 presign 시점에 생성(status=uploaded). 파일이 도착하면 OCR이 status를 진행시킴.

## 보안

- presigned URL은 **단명(300초)** 서명 URL. CORS `*`는 preflight 허용일 뿐 추가 노출 아님.
- Lambda는 presigned 발급에 추가 권한 불필요(서명만, 기존 `s3:PutObject` 보유 → 브라우저 PUT 인가됨).

## 영향 파일

- `backend/utils/storage.py` — `presigned_put_url` 추가
- `backend/handlers/upload_handler.py` — `_handle_upload`를 presign 발급으로 교체(+import)
- `frontend/api.js` — `uploadFile` 2단계 + 50MB 체크
- `backend/tests/test_upload_presign.py` — 신규

## 테스트

**백엔드** (`backend/tests/`, 기존 컨벤션):
- `POST /upload`(JSON filename/user_id) → `{doc_id, upload_url}` 반환, 레코드 `status=uploaded`·`file_path=uploads/{doc_id}/{filename}` 저장(`save_document`·`presigned_put_url` monkeypatch).
- 잘못된 확장자(.exe) → `success=False` 400.
- filename 없음 → 400.

**프론트**: 러너 없음 → `npm run build` + 수동(큰 파일 업로드 → S3 직접 PUT → 분석 완료까지).

## 리스크

- 클라이언트 크기 체크라 악의적 우회 가능(서버 강제 없음) — (가) 합의, 캡스톤 수용.
- 초대형 문서는 OCR `raw_text`가 DynamoDB 400KB 항목 한도에 걸릴 수 있음(별개 이슈, 본 작업 범위 밖).
