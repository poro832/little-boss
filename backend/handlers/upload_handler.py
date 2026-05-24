"""
STEP 1: 파일 업로드 핸들러
로컬: 파일을 local_uploads/ 에 저장
AWS:  파일을 S3에 저장 후 OCR Lambda 트리거 (API Gateway 이벤트)
"""
import os
import json
import base64
import cgi
import io
from models.document import Document
from utils.storage import save_file, save_document, get_document, list_documents, delete_document
import dataclasses


ALLOWED_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif",
    ".docx", ".hwpx", ".txt", ".md", ".csv", ".hwp", ".doc",
}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
}


def handle(event, context=None):
    """Lambda 진입점 — API Gateway 경로/메서드에 따라 라우팅"""
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')
    path_params = event.get('pathParameters') or {}

    if method == 'GET' and path == '/health':
        result = {'status': 'ok', 'env': os.getenv('ENV', 'local')}
        return _response(200, result)

    if method == 'GET' and path == '/documents':
        user_id = (event.get('queryStringParameters') or {}).get('user_id', 'anonymous')
        docs = list_documents(user_id)
        return _response(200, {'success': True, 'documents': docs})

    if method == 'GET' and '/documents/' in path:
        doc_id = path_params.get('doc_id', '')
        doc = get_document(doc_id)
        if not doc:
            return _response(404, {'success': False, 'message': '문서를 찾을 수 없습니다.'})
        return _response(200, {'success': True, 'document': doc})

    if method == 'DELETE' and '/documents/' in path:
        doc_id = path_params.get('doc_id', '')
        try:
            delete_document(doc_id)
            return _response(200, {'success': True, 'message': '문서가 삭제되었습니다.'})
        except Exception as e:
            return _response(500, {'success': False, 'message': f'삭제 실패: {str(e)}'})

    if method == 'POST' and path == '/upload':
        return _handle_upload(event)

    if method == 'POST' and path == '/auth/signup':
        from handlers.auth_handler import signup
        b = _json_body(event)
        r = signup(b.get('name'), b.get('email'), b.get('password'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'POST' and path == '/auth/login':
        from handlers.auth_handler import login
        b = _json_body(event)
        r = login(b.get('email'), b.get('password'))
        return _response(r.pop('code', 200 if r.get('success') else 401), r)

    # ── 프로필/계정 관리 ──
    if method == 'PATCH' and path == '/auth/profile':
        from handlers.auth_handler import update_profile
        b = _json_body(event)
        r = update_profile(b.get('user_id'), b.get('name'), b.get('affiliation'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'POST' and path == '/auth/change-password':
        from handlers.auth_handler import change_password
        b = _json_body(event)
        r = change_password(b.get('user_id'), b.get('current_password'), b.get('new_password'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'POST' and path == '/auth/notif-settings':
        from handlers.auth_handler import update_notif_settings
        b = _json_body(event)
        r = update_notif_settings(b.get('user_id'), b.get('settings'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'DELETE' and path == '/auth/account':
        from handlers.auth_handler import delete_account
        user_id = (event.get('queryStringParameters') or {}).get('user_id') or _json_body(event).get('user_id')
        r = delete_account(user_id)
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    # ── 비밀번호 찾기 (이메일 인증 코드) ──
    if method == 'POST' and path == '/auth/reset/request':
        from handlers.auth_handler import request_reset
        b = _json_body(event)
        r = request_reset(b.get('email'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'POST' and path == '/auth/reset/verify':
        from handlers.auth_handler import verify_reset
        b = _json_body(event)
        r = verify_reset(b.get('email'), b.get('code'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    if method == 'POST' and path == '/auth/reset/confirm':
        from handlers.auth_handler import confirm_reset
        b = _json_body(event)
        r = confirm_reset(b.get('email'), b.get('code'), b.get('new_password'))
        return _response(r.pop('code', 200 if r.get('success') else 400), r)

    return _response(400, {'success': False, 'message': f'알 수 없는 경로: {method} {path}'})


def _json_body(event) -> dict:
    """JSON 본문 파싱 (base64 인코딩 대응)"""
    body = event.get('body') or '{}'
    if event.get('isBase64Encoded'):
        body = base64.b64decode(body).decode('utf-8', errors='ignore')
    try:
        return json.loads(body) if isinstance(body, str) else json.loads(body.decode())
    except Exception:
        return {}


def _handle_upload(event):
    """멀티파트 폼 데이터 파싱 후 업로드 처리"""
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    content_type = headers.get('content-type', '')
    body = event.get('body', '')
    if event.get('isBase64Encoded'):
        body = base64.b64decode(body)
    else:
        body = body.encode()

    fp = io.BytesIO(body)
    environ = {
        'REQUEST_METHOD': 'POST',
        'CONTENT_TYPE': content_type,
        'CONTENT_LENGTH': str(len(body))
    }
    form = cgi.FieldStorage(fp=fp, environ=environ, keep_blank_values=True)

    if 'file' not in form:
        return _response(400, {'success': False, 'message': '파일이 없습니다.'})

    file_field = form['file']
    filename = file_field.filename
    file_bytes = file_field.file.read()
    user_id = form.getvalue('user_id', 'anonymous')

    result = process(filename, file_bytes, user_id)
    return _response(200 if result['success'] else 400, result)


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, ensure_ascii=False)
    }


def process(filename: str, file_bytes: bytes, user_id: str = "local_user") -> dict:
    """
    업로드 처리
    반환: { doc_id, status, message }
    """
    ext = os.path.splitext(filename)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        return {"success": False, "message": f"지원하지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXTENSIONS)})"}

    if len(file_bytes) > MAX_FILE_SIZE:
        return {"success": False, "message": "파일 크기가 20MB를 초과합니다."}

    doc = Document(filename=filename, user_id=user_id, status="uploaded")

    file_path = save_file(file_bytes, filename, doc.doc_id)

    doc_data = dataclasses.asdict(doc)
    doc_data["file_path"] = file_path
    save_document(doc.doc_id, doc_data)

    return {
        "success": True,
        "doc_id": doc.doc_id,
        "filename": filename,
        "status": "uploaded",
        "message": "업로드 완료. 분석을 시작합니다."
    }
