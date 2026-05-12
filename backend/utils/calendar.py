"""
Google Calendar API 연동 - 분석된 일정을 사용자 캘린더에 등록
프론트엔드가 Google OAuth 처리 후 access_token을 백엔드에 전달하는 방식
"""
import requests

CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


def create_events(events: list, access_token: str) -> list:
    """
    이벤트 목록을 Google Calendar에 일괄 등록

    Args:
        events: [{"title", "date", "time", "description"}, ...]
        access_token: Google OAuth access token

    Returns:
        [{"title", "id", "link", "status"} | {"title", "status": "failed", "error"}]
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    results = []

    for event in events:
        body = _build_event_body(event)
        try:
            resp = requests.post(CALENDAR_API_URL, headers=headers, json=body, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            results.append({
                "title": event["title"],
                "id": data.get("id"),
                "link": data.get("htmlLink"),
                "status": "created"
            })
        except requests.HTTPError as e:
            results.append({
                "title": event["title"],
                "status": "failed",
                "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            })
        except Exception as e:
            results.append({
                "title": event["title"],
                "status": "failed",
                "error": str(e)
            })

    return results


def _build_event_body(event: dict) -> dict:
    """LittleBoss 이벤트 → Google Calendar API 본문 변환"""
    date = event["date"]  # YYYY-MM-DD
    start_time = event.get("time", "09:00")
    end_time = _add_minutes(start_time, 30)

    return {
        "summary": event["title"],
        "description": event.get("description", ""),
        "start": {
            "dateTime": f"{date}T{start_time}:00",
            "timeZone": "Asia/Seoul"
        },
        "end": {
            "dateTime": f"{date}T{end_time}:00",
            "timeZone": "Asia/Seoul"
        },
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "popup", "minutes": 24 * 60 * 7},  # D-7
                {"method": "popup", "minutes": 24 * 60 * 3},  # D-3
                {"method": "popup", "minutes": 24 * 60}        # D-1
            ]
        }
    }


def _add_minutes(time_str: str, minutes: int) -> str:
    """HH:MM 에 분 추가 (자정 넘으면 23:59로 캡)"""
    try:
        h, m = map(int, time_str.split(":"))
        total = h * 60 + m + minutes
        if total >= 24 * 60:
            total = 24 * 60 - 1
        return f"{total // 60:02d}:{total % 60:02d}"
    except Exception:
        return "09:30"
