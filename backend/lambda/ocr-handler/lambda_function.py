"""
littleboss-ocr-handler Lambda

트리거: S3 이벤트 (s3:ObjectCreated:*, 접두사: uploads/)
타임아웃: 60초 | 메모리: 256MB

환경변수:
  S3_BUCKET=littleboss-documents
  DOCUMENTS_TABLE=littleboss-documents

동작:
  S3 uploads/에 파일 생성 → Textract OCR → 결과 S3 저장 → DynamoDB status="ocr_done"
  이 status 변경이 DynamoDB Streams를 통해 ai-analyzer를 자동 트리거
"""
import json
import os
from datetime import datetime

import boto3

s3 = boto3.client('s3')
textract = boto3.client('textract', region_name='ap-northeast-2')
dynamodb = boto3.resource('dynamodb')

S3_BUCKET = os.environ.get('S3_BUCKET', 'littleboss-documents')
DOCUMENTS_TABLE = os.environ.get('DOCUMENTS_TABLE', 'littleboss-documents')


def lambda_handler(event, context):
    """S3 이벤트로부터 자동 호출"""
    table = dynamodb.Table(DOCUMENTS_TABLE)

    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']

        # key 형식: uploads/{doc_id}/{filename}
        parts = key.split('/')
        if len(parts) < 3 or parts[0] != 'uploads':
            print(f"무시: 예상 경로 아님 → {key}")
            continue

        doc_id = parts[1]
        print(f"OCR 시작: doc_id={doc_id}, key={key}")

        # doc_id로 문서 조회하여 user_id 확인
        doc = _get_document(table, doc_id)
        if not doc:
            print(f"문서 없음: doc_id={doc_id}")
            continue

        user_id = doc.get('user_id', 'anonymous')

        try:
            # Textract OCR 호출
            extracted_text = _run_textract(bucket, key)

            # OCR 결과를 S3에 저장
            ocr_key = f"ocr-results/{doc_id}/result.json"
            s3.put_object(
                Bucket=bucket,
                Key=ocr_key,
                Body=json.dumps({
                    'text': extracted_text,
                    'doc_id': doc_id,
                }, ensure_ascii=False),
                ContentType='application/json'
            )

            # DynamoDB 상태 업데이트 → "ocr_done"
            # 이 변경이 DynamoDB Streams → ai-analyzer를 트리거
            table.update_item(
                Key={'doc_id': doc_id, 'user_id': user_id},
                UpdateExpression='SET #s = :s, raw_text = :t, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'ocr_done',
                    ':t': extracted_text,
                    ':u': datetime.utcnow().isoformat(),
                }
            )

            print(f"OCR 완료: doc_id={doc_id}, 텍스트 {len(extracted_text)}자")

        except Exception as e:
            print(f"OCR 실패: doc_id={doc_id}, error={str(e)}")
            table.update_item(
                Key={'doc_id': doc_id, 'user_id': user_id},
                UpdateExpression='SET #s = :s, error_message = :e, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'error',
                    ':e': f'OCR 실패: {str(e)}',
                    ':u': datetime.utcnow().isoformat(),
                }
            )


def _run_textract(bucket, key):
    """Textract로 텍스트 추출"""
    response = textract.analyze_document(
        Document={
            'S3Object': {
                'Bucket': bucket,
                'Name': key
            }
        },
        FeatureTypes=['TABLES', 'FORMS']
    )

    lines = [
        block['Text']
        for block in response['Blocks']
        if block['BlockType'] == 'LINE'
    ]
    text = '\n'.join(lines)

    if not text.strip():
        return '__IMAGE_FILE__'
    return text


def _get_document(table, doc_id):
    """doc_id로 문서 조회 (user_id GSI 활용)"""
    from boto3.dynamodb.conditions import Key

    # GSI가 아닌 scan으로 doc_id 조회 (PK만으로 조회 시)
    resp = table.query(
        KeyConditionExpression=Key('doc_id').eq(doc_id)
    )
    items = resp.get('Items', [])
    return items[0] if items else None
