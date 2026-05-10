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
from utils.storage import save_file, save_document, get_document, list_documents
import dataclasses


ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

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

    if method == 'POST' and path == '/upload':
        return _handle_upload(event)

    return _response(400, {'success': False, 'message': f'알 수 없는 경로: {method} {path}'})


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
        return {"success": False, "message": "파일 크기가 10MB를 초과합니다."}

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
