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


def presigned_put_url(s3_key: str, expires: int = 300) -> str:
    """S3 PUT presigned URL 발급 (브라우저가 S3에 직접 업로드).
    로컬 모드는 S3가 없으므로 placeholder를 반환한다(로컬 업로드는 process()/save_file 사용)."""
    if ENV == "local":
        return f"local://{s3_key}"

    import boto3
    s3 = boto3.client('s3')
    return s3.generate_presigned_url(
        'put_object',
        Params={'Bucket': os.getenv('S3_BUCKET'), 'Key': s3_key},
        ExpiresIn=expires,
    )


def delete_document(doc_id: str) -> bool:
    """문서 삭제: 메타데이터(DynamoDB) + 업로드 파일·OCR 결과(S3)"""
    if ENV == "local":
        path = LOCAL_DB_PATH / f"{doc_id}.json"
        if path.exists():
            path.unlink()
        return True

    import boto3
    bucket = os.getenv('S3_BUCKET')
    doc = get_document(doc_id)

    # S3 파일 삭제 (업로드 원본 + ocr-results 마커)
    s3 = boto3.client('s3')
    keys = []
    if doc and doc.get('file_path'):
        keys.append(doc['file_path'])
    keys.append(f"ocr-results/{doc_id}.json")
    for k in keys:
        try:
            s3.delete_object(Bucket=bucket, Key=k)
        except Exception as e:
            print(f"S3 삭제 경고 ({k}): {e}")

    # DynamoDB 레코드 삭제
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('DOCUMENTS_TABLE', 'sgu-pj-03-documents'))
    table.delete_item(Key={'doc_id': doc_id})
    return True


def get_user(user_id: str) -> dict:
    """사용자 조회 (이메일/비밀번호 인증). 없으면 None"""
    if ENV == "local":
        path = LOCAL_DB_PATH / "_users.json"
        if not path.exists():
            return None
        users = json.loads(path.read_text(encoding="utf-8"))
        return users.get(user_id)

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('USERS_TABLE', 'sgu-pj-03-users'))
    resp = table.get_item(Key={'user_id': user_id})
    return resp.get('Item')


def save_user(data: dict):
    """사용자 저장 (data['user_id'] 필수)"""
    if ENV == "local":
        path = LOCAL_DB_PATH / "_users.json"
        users = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        users[data["user_id"]] = data
        path.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('USERS_TABLE', 'sgu-pj-03-users'))
    table.put_item(Item=data)


def update_user_attrs(user_id: str, attrs: dict):
    """사용자 레코드의 일부 속성만 갱신한다.

    save_user()는 put_item이라 레코드를 통째로 덮어쓴다. 마감 스캔이 last_notified를
    쓰는 동안 사용자가 프로필을 저장하면 한쪽이 사라지므로, 푸시 관련 쓰기는
    update_item으로 해당 속성만 건드린다.
    """
    if not user_id or not attrs:
        return
    if ENV == "local":
        path = LOCAL_DB_PATH / "_users.json"
        users = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        users.setdefault(user_id, {"user_id": user_id}).update(attrs)
        path.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('USERS_TABLE', 'sgu-pj-03-users'))
    # 속성명이 예약어와 겹칠 수 있어 전부 플레이스홀더로 치환한다.
    names = {f"#k{i}": k for i, k in enumerate(attrs)}
    values = {f":v{i}": v for i, v in enumerate(attrs.values())}
    expr = "SET " + ", ".join(f"#k{i} = :v{i}" for i in range(len(attrs)))
    table.update_item(
        Key={'user_id': user_id},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def scan_users(filter_attr: str = None) -> list:
    """전체 사용자 목록. filter_attr가 주어지면 그 속성이 있는 사용자만.

    한계: 테이블 전체 Scan이다. 졸작 규모(수십~수백 명)에서는 문제없지만
    수천 명이 되면 GSI나 별도 구독 테이블로 옮겨야 한다.
    """
    if ENV == "local":
        path = LOCAL_DB_PATH / "_users.json"
        if not path.exists():
            return []
        users = list(json.loads(path.read_text(encoding="utf-8")).values())
        return [u for u in users if not filter_attr or u.get(filter_attr)]

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('USERS_TABLE', 'sgu-pj-03-users'))
    kwargs = {}
    if filter_attr:
        kwargs = {
            'FilterExpression': 'attribute_exists(#a)',
            'ExpressionAttributeNames': {'#a': filter_attr},
        }
    out, resp = [], None
    while True:
        if resp and resp.get('LastEvaluatedKey'):
            kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']
        resp = table.scan(**kwargs)
        out.extend(resp.get('Items', []))
        if not resp.get('LastEvaluatedKey'):
            return out


def delete_user(user_id: str) -> bool:
    """사용자 레코드 삭제 (회원 탈퇴)."""
    if ENV == "local":
        path = LOCAL_DB_PATH / "_users.json"
        if path.exists():
            users = json.loads(path.read_text(encoding="utf-8"))
            users.pop(user_id, None)
            path.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")
        return True

    import boto3
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.getenv('USERS_TABLE', 'sgu-pj-03-users'))
    table.delete_item(Key={'user_id': user_id})
    return True


def put_s3_json(key: str, data: dict):
    """S3에 작은 JSON 객체 저장 (ai-analyzer 트리거용 마커).
    로컬에서는 동작하지 않음 (S3 이벤트가 로컬에 없으므로)."""
    if ENV == "local":
        return
    import boto3
    s3 = boto3.client('s3')
    s3.put_object(
        Bucket=os.getenv('S3_BUCKET'),
        Key=key,
        Body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )


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
