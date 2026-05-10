"""
littleboss-action-executor Lambda

트리거: API Gateway
엔드포인트: POST /calendar/{doc_id}, GET /checklist/{doc_id}, PATCH /checklist/{doc_id}
타임아웃: 30초 | 메모리: 256MB

환경변수:
  DOCUMENTS_TABLE=littleboss-documents
  CHECKLISTS_TABLE=littleboss-checklists
  USERS_TABLE=littleboss-users
  GOOGLE_CLIENT_ID=****
  GOOGLE_CLIENT_SECRET=****
  SNS_TOPIC_ARN=****
"""
import json
import os
from datetime import datetime

import boto3

dynamodb = boto3.resource('dynamodb')

DOCUMENTS_TABLE = os.environ.get('DOCUMENTS_TABLE', 'littleboss-documents')
CHECKLISTS_TABLE = os.environ.get('CHECKLISTS_TABLE', 'littleboss-checklists')
USERS_TABLE = os.environ.get('USERS_TABLE', 'littleboss-users')


def lambda_handler(event, context):
    http_method = event.get('httpMethod', '')
    path = event.get('path', '')

    # CORS preflight
    if http_method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    # doc_id 추출
    path_params = event.get('pathParameters') or {}
    doc_id = path_params.get('doc_id', '')
    if not doc_id:
        parts = path.strip('/').split('/')
        if len(parts) >= 2:
            doc_id = parts[-1]

    if not doc_id:
        return _response(400, {'success': False, 'message': 'doc_id가 필요합니다.'})

    # POST /calendar/{doc_id}
    if http_method == 'POST' and '/calendar/' in path:
        return _handle_calendar(doc_id, event)

    # GET /checklist/{doc_id}
    if http_method == 'GET' and '/checklist/' in path:
        return _handle_get_checklist(doc_id)

    # PATCH /checklist/{doc_id}
    if http_method == 'PATCH' and '/checklist/' in path:
        return _handle_update_checklist(doc_id, event)

    return _response(404, {'success': False, 'message': 'Not Found'})


def _handle_calendar(doc_id, event):
    """Google Calendar에 일정 등록 + EventBridge 알림 예약"""
    doc_table = dynamodb.Table(DOCUMENTS_TABLE)

    # 문서 조회
    doc = _get_document(doc_table, doc_id)
    if not doc:
        return _response(404, {'success': False, 'message': '문서를 찾을 수 없습니다.'})

    analysis = doc.get('analysis', {})
    events = list(analysis.get('calendar_events', []))
    deadlines = analysis.get('deadlines', [])

    # deadline도 캘린더 이벤트로 변환
    for dl in deadlines:
        events.append({
            'title': f"[마감] {dl['description']}",
            'date': dl['date'],
            'time': '23:59',
            'description': f"긴급도: {dl.get('urgency', 'normal')}",
        })

    # TODO: Google Calendar API 연동
    # user_id = doc.get('user_id')
    # user = _get_user(user_id)
    # token = user.get('google_calendar_token')
    # if token:
    #     from google.oauth2.credentials import Credentials
    #     from googleapiclient.discovery import build
    #     creds = Credentials(token=token, ...)
    #     service = build('calendar', 'v3', credentials=creds)
    #     for ev in events:
    #         service.events().insert(calendarId='primary', body={...}).execute()

    # TODO: EventBridge Scheduler로 D-7, D-3, D-1 알림 예약
    # scheduler = boto3.client('scheduler')
    # sns_topic_arn = os.environ.get('SNS_TOPIC_ARN')
    # for dl in deadlines:
    #     for days_before in [7, 3, 1]:
    #         schedule_time = ...
    #         scheduler.create_schedule(
    #             Name=f"littleboss-{doc_id}-d{days_before}",
    #             GroupName='littleboss-reminders',
    #             ScheduleExpression=f"at({schedule_time})",
    #             Target={'Arn': sns_topic_arn, ...},
    #             FlexibleTimeWindow={'Mode': 'OFF'},
    #         )

    return _response(200, {
        'success': True,
        'message': f'{len(events)}개 일정을 캘린더에 등록했습니다.',
        'events_registered': events,
        'count': len(events),
    })


def _handle_get_checklist(doc_id):
    """체크리스트 조회"""
    doc_table = dynamodb.Table(DOCUMENTS_TABLE)

    doc = _get_document(doc_table, doc_id)
    if not doc:
        return _response(404, {'success': False, 'message': '문서를 찾을 수 없습니다.'})

    analysis = doc.get('analysis') or {}
    required_docs = analysis.get('required_documents', [])

    # 체크리스트가 아직 없으면 분석 결과에서 생성
    checklist = doc.get('checklist')
    if not checklist:
        checklist = [
            {'name': d['name'], 'description': d.get('description', ''), 'completed': False}
            for d in required_docs
        ]
        # DynamoDB에 저장
        user_id = doc.get('user_id', 'anonymous')
        doc_table.update_item(
            Key={'doc_id': doc_id, 'user_id': user_id},
            UpdateExpression='SET checklist = :c',
            ExpressionAttributeValues={':c': checklist},
        )

    return _response(200, {
        'success': True,
        'doc_id': doc_id,
        'checklist': checklist,
        'total': len(checklist),
        'completed': sum(1 for item in checklist if item.get('completed')),
    })


def _handle_update_checklist(doc_id, event):
    """체크리스트 항목 완료 처리"""
    try:
        body = json.loads(event.get('body', '{}'))
    except json.JSONDecodeError:
        return _response(400, {'success': False, 'message': '잘못된 요청 형식입니다.'})

    item_name = body.get('name')
    completed = body.get('completed', False)

    if not item_name:
        return _response(400, {'success': False, 'message': 'name 필드가 필요합니다.'})

    doc_table = dynamodb.Table(DOCUMENTS_TABLE)
    doc = _get_document(doc_table, doc_id)
    if not doc:
        return _response(404, {'success': False, 'message': '문서를 찾을 수 없습니다.'})

    checklist = doc.get('checklist', [])
    updated = False
    for item in checklist:
        if item['name'] == item_name:
            item['completed'] = completed
            updated = True
            break

    if not updated:
        return _response(404, {'success': False, 'message': f"항목 '{item_name}'을 찾을 수 없습니다."})

    # DynamoDB 업데이트
    user_id = doc.get('user_id', 'anonymous')
    doc_table.update_item(
        Key={'doc_id': doc_id, 'user_id': user_id},
        UpdateExpression='SET checklist = :c, updated_at = :u',
        ExpressionAttributeValues={
            ':c': checklist,
            ':u': datetime.utcnow().isoformat(),
        },
    )

    return _response(200, {
        'success': True,
        'message': f"'{item_name}' 상태 업데이트 완료",
    })


def _get_document(table, doc_id):
    """doc_id로 문서 조회"""
    from boto3.dynamodb.conditions import Key
    resp = table.query(
        KeyConditionExpression=Key('doc_id').eq(doc_id)
    )
    items = resp.get('Items', [])
    return items[0] if items else None


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        'body': json.dumps(body, default=str, ensure_ascii=False)
    }
