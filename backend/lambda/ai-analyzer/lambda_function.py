"""
littleboss-ai-analyzer Lambda

트리거: DynamoDB Streams (littleboss-documents 테이블, status="ocr_done"일 때만 처리)
타임아웃: 60초 | 메모리: 256MB

환경변수:
  S3_BUCKET=sgu-pj-01-littleboss-docs
  DOCUMENTS_TABLE=sgu-pj-01-documents
  BEDROCK_REGION=us-east-1
  BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

동작:
  DynamoDB status 변경 감지 → "ocr_done"일 때만 → Bedrock Claude 3 Sonnet 호출
  → 분석 결과 저장 → status="done"

비고:
  Lambda는 서울(ap-northeast-2)에 배포되지만 Bedrock은 us-east-1에서 호출 (cross-region).
  이는 학교 계정의 RestrictRegionSeoul 정책으로 서울 리전 Bedrock이 차단되어 있기 때문.
"""
import json
import os
import re
from datetime import datetime

import boto3

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client(
    'bedrock-runtime',
    region_name=os.environ.get('BEDROCK_REGION', 'us-east-1')
)

S3_BUCKET = os.environ.get('S3_BUCKET', 'sgu-pj-01-littleboss-docs')
DOCUMENTS_TABLE = os.environ.get('DOCUMENTS_TABLE', 'sgu-pj-01-documents')
MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')

PROMPT_TEMPLATE = """당신은 한국 행정 서류 분석 전문가입니다.
아래 문서 내용을 분석하여 반드시 JSON 형식으로만 반환하세요.
다른 설명 없이 JSON만 출력하세요.

출력 형식:
{{
  "document_type": "서류 종류 (예: 장학금 공지, 인턴십 모집, 공모전 등)",
  "summary": "문서 핵심 내용 2~3줄 요약",
  "deadlines": [
    {{"date": "YYYY-MM-DD", "description": "마감 내용", "urgency": "high/normal/low"}}
  ],
  "required_documents": [
    {{"name": "서류명", "description": "설명", "have": false}}
  ],
  "calendar_events": [
    {{"title": "일정 제목", "date": "YYYY-MM-DD", "time": "HH:MM", "description": "설명"}}
  ]
}}

분석할 문서:
{text}
"""


def lambda_handler(event, context):
    """DynamoDB Streams에서 자동 호출"""
    table = dynamodb.Table(DOCUMENTS_TABLE)

    for record in event['Records']:
        if record['eventName'] not in ['INSERT', 'MODIFY']:
            continue

        new_image = record['dynamodb'].get('NewImage', {})
        status = new_image.get('status', {}).get('S', '')

        # status가 "ocr_done"인 경우에만 AI 분석 실행 (무한 루프 방지 핵심)
        if status != 'ocr_done':
            continue

        doc_id = new_image.get('doc_id', {}).get('S', '')
        user_id = new_image.get('user_id', {}).get('S', '')
        raw_text = new_image.get('raw_text', {}).get('S', '')

        print(f"AI 분석 시작: doc_id={doc_id}, model={MODEL_ID}")

        _update_status(table, doc_id, user_id, 'ai_processing')

        try:
            analysis = _analyze_with_bedrock(raw_text)

            checklist = [
                {'name': d['name'], 'description': d.get('description', ''), 'completed': False}
                for d in analysis.get('required_documents', [])
            ]

            table.update_item(
                Key={'doc_id': doc_id, 'user_id': user_id},
                UpdateExpression='SET #s = :s, analysis = :a, checklist = :c, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'done',
                    ':a': analysis,
                    ':c': checklist,
                    ':u': datetime.utcnow().isoformat(),
                }
            )

            s3.put_object(
                Bucket=S3_BUCKET,
                Key=f"analysis-results/{doc_id}/result.json",
                Body=json.dumps(analysis, ensure_ascii=False),
                ContentType='application/json'
            )

            print(f"AI 분석 완료: doc_id={doc_id}, type={analysis.get('document_type', 'unknown')}")

        except Exception as e:
            print(f"AI 분석 실패: doc_id={doc_id}, error={str(e)}")
            _update_status(table, doc_id, user_id, 'error', str(e))


def _analyze_with_bedrock(text):
    """Bedrock Claude 3 Sonnet으로 서류 분석"""
    prompt = PROMPT_TEMPLATE.format(text=text)

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps(request_body),
        contentType='application/json',
        accept='application/json',
    )

    response_body = json.loads(response['body'].read())
    response_text = response_body['content'][0]['text']
    return _parse_response(response_text)


def _parse_response(raw):
    """Claude 응답에서 JSON 추출"""
    raw = re.sub(r"```json\s*|\s*```", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            'document_type': '알 수 없음',
            'summary': '분석 실패 - 다시 시도해주세요',
            'deadlines': [],
            'required_documents': [],
            'calendar_events': [],
        }


def _update_status(table, doc_id, user_id, status, error_message=None):
    update_expr = 'SET #s = :s, updated_at = :u'
    expr_values = {
        ':s': status,
        ':u': datetime.utcnow().isoformat(),
    }
    expr_names = {'#s': 'status'}

    if error_message:
        update_expr += ', error_message = :e'
        expr_values[':e'] = f'AI 분석 실패: {error_message}'

    table.update_item(
        Key={'doc_id': doc_id, 'user_id': user_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
