"""
littleboss-upload-handler Lambda

트리거: API Gateway
엔드포인트: POST /upload, GET /documents, GET /documents/{doc_id}, GET /health
타임아웃: 30초 | 메모리: 256MB

환경변수:
  S3_BUCKET=littleboss-documents-bucket
  DOCUMENTS_TABLE=littleboss-documents-table
  ENV=production

업로드 방식: Presigned URL
  1. POST /upload → presigned URL + doc_id 발급
  2. 프론트엔드가 presigned URL로 S3에 직접 업로드
  3. S3 이벤트 → OCR Handler 자동 트리거
"""
import json
import os
import uuid
from datetime import datetime

import boto3

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

S3_BUCKET = os.environ.get('S3_BUCKET', 'littleboss-documents-bucket')
DOCUMENTS_TABLE = os.environ.get('DOCUMENTS_TABLE', 'littleboss-documents-table')

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.heic'}

# Status 상수
UPLOADED = 'UPLOADED'


def lambda_handler(event, context):
    http_method = event.get('httpMethod', '')
    path = event.get('path', '')

    if http_method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if http_method == 'GET' and path == '/health':
        return _response(200, {'status': 'ok', 'env': os.environ.get('ENV', 'production')})

    if http_method == 'POST' and '/upload' in path:
        return _handle_upload(event)

    if http_method == 'GET' and '/documents/' in path:
        return _handle_get_document(event)

    if http_method == 'GET' and path.rstrip('/') == '/documents':
        return _handle_list_documents(event)

    return _response(404, {'success': False, 'message': 'Not Found'})


def _handle_upload(event):
    """Presigned URL 발급 + DynamoDB 레코드 생성"""
    try:
        body = json.loads(event.get('body', '{}'))
    except (json.JSONDecodeError, TypeError):
        return _response(400, {'success': False, 'message': '잘못된 요청 형식입니다.'})

    filename = body.get('filename', '')
    user_id = body.get('user_id', 'anonymous')

    if not filename:
        return _response(400, {'success': False, 'message': 'filename이 필요합니다.'})

    # 확장자 검증
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return _response(400, {
            'success': False,
            'message': f"지원하지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXTENSIONS)})"
        })

    doc_id = str(uuid.uuid4())
    s3_key = f"uploads/{doc_id}/{filename}"

    # S3 Presigned URL 발급 (5분 유효)
    upload_url = s3.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': S3_BUCKET,
            'Key': s3_key,
        },
        ExpiresIn=300,
    )

    # DynamoDB에 문서 레코드 생성
    table = dynamodb.Table(DOCUMENTS_TABLE)
    table.put_item(Item={
        'doc_id': doc_id,
        'user_id': user_id,
        'filename': filename,
        'file_path': s3_key,
        'status': UPLOADED,
        'created_at': datetime.utcnow().isoformat(),
    })

    return _response(200, {
        'success': True,
        'doc_id': doc_id,
        'upload_url': upload_url,
        'filename': filename,
        'status': UPLOADED,
        'message': 'Presigned URL 발급 완료. 이 URL로 파일을 업로드하세요.',
    })


def _handle_get_document(event):
    """문서 상태 및 분석 결과 조회 (프론트엔드 폴링용)"""
    path_params = event.get('pathParameters') or {}
    doc_id = path_params.get('doc_id', '')

    if not doc_id:
        path = event.get('path', '')
        parts = path.strip('/').split('/')
        if len(parts) >= 2:
            doc_id = parts[-1]

    table = dynamodb.Table(DOCUMENTS_TABLE)
    resp = table.get_item(Key={'doc_id': doc_id})
    item = resp.get('Item')

    if not item:
        return _response(404, {'success': False, 'message': '문서를 찾을 수 없습니다.'})

    return _response(200, {'success': True, 'document': item})


def _handle_list_documents(event):
    """사용자 문서 목록 조회"""
    from boto3.dynamodb.conditions import Key

    query_params = event.get('queryStringParameters') or {}
    user_id = query_params.get('user_id', 'anonymous')

    table = dynamodb.Table(DOCUMENTS_TABLE)
    resp = table.query(
        IndexName='user_id-index',
        KeyConditionExpression=Key('user_id').eq(user_id),
        ScanIndexForward=False,
    )

    return _response(200, {'success': True, 'documents': resp.get('Items', [])})


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        'body': json.dumps(body, default=str, ensure_ascii=False),
    }
