"""
STEP 4: 액션 핸들러
분석 결과를 바탕으로 캘린더 등록, 체크리스트 저장, SNS 알림 발송
로컬: 결과를 JSON으로 출력 (캘린더 연동은 API 키 받은 후)
AWS:  Google Calendar API + DynamoDB 저장 + SNS publish
"""
import os
import json
from utils.storage import get_document, save_document


def _publish_sns(subject: str, message: str) -> bool:
    """SNS 토픽에 알림 발송 (Lambda 프로덕션 환경에서만 동작)"""
    topic_arn = os.getenv("SNS_TOPIC_ARN")
    if not topic_arn or os.getenv("ENV") == "local":
        return False
    try:
        import boto3
        boto3.client("sns").publish(
            TopicArn=topic_arn,
            Subject=subject[:100],  # SNS 제목 100자 제한
            Message=message
        )
        return True
    except Exception as e:
        print(f"SNS publish 실패: {e}")
        return False


def handle(event, context=None):
    """Lambda 진입점 — API Gateway 경로/메서드에 따라 라우팅"""
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')
    path_params = event.get('pathParameters') or {}
    doc_id = path_params.get('doc_id', '')
    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    if '/calendar/' in path and method == 'POST':
        result = handle_calendar(doc_id, body.get('user_token'))
    elif '/checklist/' in path and method == 'GET':
        result = handle_checklist(doc_id)
    elif '/checklist/' in path and method == 'PATCH':
        result = handle_checklist_update(doc_id, body.get('name'), body.get('completed', False))
    else:
        result = {'success': False, 'message': f'알 수 없는 경로: {method} {path}'}

    return {
        'statusCode': 200 if result.get('success') else 400,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps(result, ensure_ascii=False)
    }


def handle_calendar(doc_id: str, user_token: str = None) -> dict:
    """
    Google Calendar 등록
    로컬 환경에서는 등록할 이벤트 목록만 반환
    """
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": f"문서를 찾을 수 없습니다: {doc_id}"}

    analysis = doc.get("analysis", {})
    events = analysis.get("calendar_events", [])
    deadlines = analysis.get("deadlines", [])

    # deadline도 캘린더 이벤트로 변환
    for dl in deadlines:
        events.append({
            "title": f"[마감] {dl['description']}",
            "date": dl["date"],
            "time": "23:59",
            "description": f"긴급도: {dl['urgency']}"
        })

    # Google Calendar API 등록
    created_events = []
    if user_token and events:
        from utils.calendar import create_events
        created_events = create_events(events, user_token)

    # SNS 알림 발송: 등록된 일정 요약
    if events:
        doc_type = analysis.get("document_type", "문서")
        summary_lines = [f"- {e['date']} {e.get('time','')} : {e['title']}" for e in events[:10]]
        success_count = sum(1 for c in created_events if c.get("status") == "created")
        head = (
            f"캘린더 {success_count}/{len(events)}개 등록 완료\n\n"
            if created_events else f"등록 예정 일정 {len(events)}개:\n\n"
        )
        message = f"[LittleBoss] '{doc_type}' 분석 완료\n\n{head}" + "\n".join(summary_lines)
        _publish_sns(f"LittleBoss: {doc_type} 일정 등록", message)

    return {
        "success": True,
        "message": (
            f"{len(created_events)}개 일정이 캘린더에 등록되었습니다."
            if created_events else "user_token이 없어 등록 예정 목록만 반환합니다."
        ),
        "events_to_register": events,
        "created_events": created_events,
        "count": len(events)
    }


def handle_checklist(doc_id: str) -> dict:
    """
    체크리스트 조회 및 저장
    """
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": f"문서를 찾을 수 없습니다: {doc_id}"}

    analysis = doc.get("analysis") or {}
    required_docs = analysis.get("required_documents", [])

    # 체크리스트 상태를 doc에 저장
    if "checklist" not in doc:
        doc["checklist"] = [
            {"name": d["name"], "description": d["description"], "completed": False}
            for d in required_docs
        ]
        save_document(doc_id, doc)

    return {
        "success": True,
        "doc_id": doc_id,
        "checklist": doc["checklist"],
        "total": len(doc["checklist"]),
        "completed": sum(1 for item in doc["checklist"] if item["completed"])
    }


def handle_checklist_update(doc_id: str, item_name: str, completed: bool) -> dict:
    """
    체크리스트 항목 완료 처리
    """
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": f"문서를 찾을 수 없습니다: {doc_id}"}

    # checklist 미초기화 시 분석 결과(required_documents)에서 생성
    checklist = doc.get("checklist")
    if not checklist:
        required_docs = (doc.get("analysis") or {}).get("required_documents", [])
        checklist = [
            {"name": d.get("name", ""), "description": d.get("description", ""),
             "completed": bool(d.get("have", False))}
            for d in required_docs
        ]

    found = False
    for item in checklist:
        if item["name"] == item_name:
            item["completed"] = completed
            found = True
            break
    if not found:
        return {"success": False, "message": f"체크리스트 항목을 찾을 수 없습니다: {item_name}"}

    doc["checklist"] = checklist
    save_document(doc_id, doc)
    return {
        "success": True,
        "message": f"'{item_name}' 상태 업데이트 완료",
        "checklist": checklist,
        "total": len(checklist),
        "completed": sum(1 for i in checklist if i["completed"]),
    }
