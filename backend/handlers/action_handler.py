"""
STEP 4: 액션 핸들러
분석 결과를 바탕으로 캘린더 등록, 체크리스트 저장
로컬: 결과를 JSON으로 출력 (캘린더 연동은 API 키 받은 후)
AWS:  Google Calendar API + DynamoDB 저장 (API Gateway 이벤트로 트리거)
"""
import json
from utils.storage import get_document, save_document


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

    # TODO: Google Calendar API 연동
    # if user_token:
    #     from utils.calendar import create_events
    #     created = create_events(events, user_token)
    #     return {"success": True, "created_events": created}

    return {
        "success": True,
        "message": "로컬 환경: 아래 이벤트를 캘린더에 등록 예정",
        "events_to_register": events,
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

    checklist = doc.get("checklist", [])
    for item in checklist:
        if item["name"] == item_name:
            item["completed"] = completed
            break

    doc["checklist"] = checklist
    save_document(doc_id, doc)

    return {"success": True, "message": f"'{item_name}' 상태 업데이트 완료"}
