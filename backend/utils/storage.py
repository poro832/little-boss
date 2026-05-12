"""
스토리지 레이어 - 로컬(JSON 파일) / AWS S3+DynamoDB 전환 가능
ENV=local  → 로컬 JSON 파일 사용
ENV=production → AWS 사용
"""
import os
import json
import tempfile
from pathlib import Path

ENV = os.getenv("ENV", "local")
LOCAL_DB_PATH = Path(__file__).parent.parent / "local_db"
LOCAL_UPLOADS_PATH = Path(tempfile.gettempdir()) / "littleboss_uploads"

if ENV == "local":
    LOCAL_DB_PATH.mkdir(exist_ok=True)
    LOCAL_UPLOADS_PATH.mkdir(exist_ok=True)


# ── 파일 저장 ──────────────────────────────────────────────

def save_file(file_bytes: bytes, filename: str, doc_id: str) -> str:
    """파일 저장 후 경로(또는 S3 key) 반환"""
    if ENV == "local":
        path = LOCAL_UPLOADS_PATH / f"{doc_id}_{filename}"
        path.write_bytes(file_bytes)
        return str(path)

    import boto3
    s3 = boto3.client('s3')
    key = f"uploads/{doc_id}/{filename}"
    s3.put_object(Bucket=os.getenv('S3_BUCKET'), Key=key, Body=file_bytes)
    return key


def get_file(file_path: str) -> bytes:
    """파일 읽기"""
    if ENV == "local":
        return Path(file_path).read_bytes()

    import boto3
    s3 = boto3.client('s3')
    obj = s3.get_object(Bucket=os.getenv('S3_BUCKET'), Key=file_path)
    return obj['Body'].read()


# ── 문서 데이터 저장 ───────────────────────────────────────

def save_document(doc_id: str, data: dict):
    """문서 메타데이터 저장"""
    if ENV == "local":
        path = LOCAL_DB_PATH / f"{doc_id}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('DOCUMENTS_TABLE', 'sgu-pj-03-documents'))
    table.put_item(Item=data)


def get_document(doc_id: str) -> dict:
    """문서 메타데이터 조회"""
    if ENV == "local":
        path = LOCAL_DB_PATH / f"{doc_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('DOCUMENTS_TABLE', 'sgu-pj-03-documents'))
    resp = table.get_item(Key={'doc_id': doc_id})
    return resp.get('Item')


def list_documents(user_id: str = "local_user") -> list:
    """유저의 문서 목록 조회"""
    if ENV == "local":
        docs = []
        for path in LOCAL_DB_PATH.glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("user_id") == user_id:
                docs.append(data)
        return sorted(docs, key=lambda x: x.get("created_at", ""), reverse=True)

    import boto3
    from boto3.dynamodb.conditions import Key
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('DOCUMENTS_TABLE', 'sgu-pj-03-documents'))
    resp = table.query(
        IndexName='user_id-index',
        KeyConditionExpression=Key('user_id').eq(user_id),
        ScanIndexForward=False
    )
    return resp.get('Items', [])
