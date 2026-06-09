"""
STEP 4: 액션 핸들러
분석 결과를 바탕으로 캘린더 등록, 체크리스트 저장
로컬: 결과를 JSON으로 출력 (캘린더 연동은 API 키 받은 후)
AWS:  Google Calendar API + DynamoDB 저장
(문서 완료 이메일 알림은 utils/notify_email로 분리됨 — 옛 SNS 브로드캐스트는 제거)
"""
import os
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

    # Google Calendar API 등록
    created_events = []
    if user_token and events:
        from utils.calendar import create_events
        created_events = create_events(events, user_token)

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


def notify_slack_done(doc: dict):
    """source=slack 문서의 분석 완료 시: 스레드 답글 + (연결 시) 개인 Google 캘린더 등록.
    파이프라인 종료(ai-analyzer가 analysis 저장) 직후 호출한다. 비-Slack 문서는 무시."""
    if not doc or doc.get("source") != "slack":
        return
    token = os.getenv("SLACK_BOT_TOKEN")
    ch, ts = doc.get("slack_channel"), doc.get("slack_thread_ts")
    if not token or not ch or not ts:
        return
    from utils.slack import post_message
    from utils.slack_links import get_refresh_token

    a = doc.get("analysis", {}) or {}
    lines = [f"*{a.get('document_type', '문서')}* 분석 완료 ✅"]
    dls = a.get("deadlines", [])
    if dls:
        lines.append("📅 마감: " + ", ".join(f"{d.get('date')} {d.get('description', '')}".strip() for d in dls))
    reqs = a.get("required_documents", [])
    if reqs:
        lines.append("📄 필요서류: " + ", ".join(r.get("name", "") for r in reqs))

    cal = ""
    email = doc.get("user_id", "")
    slack_user = doc.get("slack_user", "")
    rt = get_refresh_token(email) if "@" in (email or "") else None
    if rt:
        from utils.slack_oauth import refresh_access_token, TokenExpiredError, build_connect_url
        from utils.slack_links import delete_link
        try:
            access = refresh_access_token(os.environ["GOOGLE_CLIENT_ID"], os.environ["GOOGLE_CLIENT_SECRET"], rt)
            r = handle_calendar(doc["doc_id"], access)
            cal = f"\n🗓️ 캘린더 {r.get('count', 0)}건 등록 완료"
        except TokenExpiredError:
            # 연동 만료/철회 → 죽은 연동 삭제 + 재연동 링크 안내 (정리 실패해도 post_message는 보장)
            try:
                if slack_user:
                    delete_link(slack_user)
                    link = build_connect_url(slack_user, ch, ts)
                    cal = f"\n⚠️ Google 연결이 만료됐어요. 다시 연결해주세요:\n{link}"
                else:
                    cal = "\n⚠️ Google 연결이 만료됐어요. 다음 업로드 때 다시 연결해주세요."
            except Exception as e:
                print(f"[SLACK_TOKEN_CLEANUP_ERROR] {e}")
                cal = "\n⚠️ Google 연결이 만료됐어요. 다음 업로드 때 다시 연결해주세요."
        except Exception as e:
            print(f"[SLACK_CAL_ERROR] {e}")
            cal = "\n⚠️ 캘린더 등록 실패 (잠시 후 다시 시도해주세요)"
    try:
        post_message(token, ch, ts, "\n".join(lines) + cal)
    except Exception as e:
        print(f"[SLACK_POST_ERROR] {e}")


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
