"""웹 푸시 발송 + 마감 스캔.

매일 09:00 KST에 EventBridge Scheduler가 upload-handler를 직접 호출하면
run_deadline_scan()이 돈다. D-7 / D-3 / D-1 에 해당하는 문서만 골라 알림을 보낸다.

pywebpush는 cryptography(네이티브)에 의존해 패키지가 5MB 정도 커진다. 그래서
모듈 최상단이 아니라 실제 발송 시점에 임포트한다 — 일반 API 요청은 이 비용을
전혀 치르지 않는다. 기존 라우팅이 쓰는 지연 임포트 관례와 같다.
"""
import os
import json
from datetime import datetime, timezone, timedelta

from utils.storage import scan_users, update_user_attrs, list_documents

KST = timezone(timedelta(hours=9))

# 알림을 보낼 시점. 준비물을 떼는 데 며칠 걸리므로 첫 알림을 D-7에 준다.
MILESTONES = (7, 3, 1)

VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY', '')
VAPID_SUBJECT = os.getenv('VAPID_SUBJECT', 'mailto:littleboss@example.com')
APP_URL = os.getenv('APP_URL', 'https://poro832.github.io/little-boss/app.html')


def today_kst() -> str:
    return datetime.now(KST).strftime('%Y-%m-%d')


def days_until(date_str: str, today: str = None) -> int:
    """오늘(KST)부터 date_str까지 남은 일수. 파싱 불가면 None."""
    if not date_str:
        return None
    try:
        d = datetime.strptime(str(date_str)[:10], '%Y-%m-%d').date()
        t = datetime.strptime(today or today_kst(), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None
    return (d - t).days


def pending_notifications(doc: dict, today: str = None, last_notified: dict = None) -> list:
    """이 문서에서 오늘 보내야 할 알림 목록.

    - 완료 처리된 문서는 보내지 않는다
    - 같은 날 같은 단계는 다시 보내지 않는다(스케줄 재시도 대비)
    """
    if not doc or doc.get('completed'):
        return []
    if doc.get('status') != 'done':
        return []          # 아직 분석 중인 문서는 마감이 확정되지 않았다

    today = today or today_kst()
    last_notified = last_notified or {}
    doc_id = doc.get('doc_id')
    out = []

    analysis = doc.get('analysis') or {}
    deadlines = analysis.get('deadlines') or doc.get('deadlines') or []

    for dl in deadlines:
        if not isinstance(dl, dict):
            continue
        left = days_until(dl.get('date'), today)
        if left not in MILESTONES:
            continue
        stamp = f"{today}:D-{left}"
        if last_notified.get(doc_id) == stamp:
            continue
        out.append({
            'doc_id': doc_id,
            'days': left,
            'stamp': stamp,
            # 앱 화면과 같은 이름을 보여준다 (api.js:107과 동일한 규칙)
            'title': analysis.get('document_type') or doc.get('filename') or '문서',
            'desc': dl.get('description') or '',
            'date': dl.get('date'),
        })

    # 한 문서에서 여러 마감이 같은 날 걸리면 가장 급한 것 하나만 보낸다.
    out.sort(key=lambda x: x['days'])
    return out[:1]


def build_payload(item: dict) -> dict:
    days = item['days']
    title = f"D-{days} · {item['title']}"
    body = item['desc'] or f"{item['date']} 마감입니다."
    return {
        'title': title,
        'body': body,
        'tag': f"lb-{item['doc_id']}",
        'url': f"{APP_URL}?page=app&sub=doc-detail&doc={item['doc_id']}",
    }


def _send_one(subscription: dict, payload: dict) -> int:
    """구독 하나에 발송. HTTP 상태코드를 돌려주고, 실패하면 0."""
    from pywebpush import webpush, WebPushException   # 지연 임포트 (위 주석 참고)
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={'sub': VAPID_SUBJECT},
            timeout=10,
        )
        return 201
    except WebPushException as e:
        return getattr(e.response, 'status_code', 0) or 0
    except Exception:
        return 0


def send_to_user(user: dict, items: list) -> dict:
    """한 사용자의 모든 구독에 발송하고, 죽은 구독은 걸러낸 목록을 돌려준다."""
    subs = user.get('push_subs') or []
    alive, sent = [], 0

    for sub in subs:
        info = {'endpoint': sub.get('endpoint'), 'keys': sub.get('keys')}
        if not info['endpoint'] or not info['keys']:
            continue
        dead = False
        for item in items:
            code = _send_one(info, build_payload(item))
            if code in (404, 410):
                # 브라우저를 지웠거나 재설치했다. 청소하지 않으면 매일 실패가 쌓인다.
                dead = True
                break
            if code in (200, 201):
                sent += 1
        if not dead:
            alive.append(sub)

    return {'sent': sent, 'alive': alive, 'removed': len(subs) - len(alive)}


def run_deadline_scan(today: str = None) -> dict:
    """스케줄 진입점. 푸시 구독이 있고 마감 알림을 켠 사용자만 훑는다."""
    today = today or today_kst()
    stats = {'users': 0, 'sent': 0, 'removed': 0, 'errors': 0}

    for user in scan_users(filter_attr='push_subs'):
        if not user.get('push_subs'):
            continue
        settings = user.get('notif_settings') or {}
        if settings.get('deadline') is False:      # 기본값은 켜짐
            continue

        stats['users'] += 1
        user_id = user.get('user_id')
        last = dict(user.get('last_notified') or {})

        try:
            items = []
            for doc in list_documents(user_id):
                items.extend(pending_notifications(doc, today, last))
            if not items:
                continue

            r = send_to_user(user, items)
            stats['sent'] += r['sent']
            stats['removed'] += r['removed']

            attrs = {}
            if r['sent']:
                for it in items:
                    last[it['doc_id']] = it['stamp']
                attrs['last_notified'] = last
            if r['removed']:
                attrs['push_subs'] = r['alive']
            if attrs:
                update_user_attrs(user_id, attrs)
        except Exception:
            # 한 사용자의 실패가 나머지 발송을 막지 않게 한다.
            stats['errors'] += 1

    return stats


# ── 구독 관리 ──────────────────────────────────────────────

def add_subscription(user_id: str, subscription: dict) -> dict:
    from utils.storage import get_user
    if not user_id or not subscription or not subscription.get('endpoint'):
        return {'success': False, 'message': '구독 정보가 올바르지 않습니다.', 'code': 400}

    user = get_user(user_id)
    if not user:
        return {'success': False, 'message': '사용자를 찾을 수 없습니다.', 'code': 404}

    subs = [s for s in (user.get('push_subs') or [])
            if s.get('endpoint') != subscription['endpoint']]   # 같은 기기면 교체
    subs.append({
        'endpoint': subscription['endpoint'],
        'keys': subscription.get('keys') or {},
        'created_at': datetime.now(timezone.utc).isoformat(),
    })
    update_user_attrs(user_id, {'push_subs': subs})
    return {'success': True, 'count': len(subs)}


def remove_subscription(user_id: str, endpoint: str) -> dict:
    from utils.storage import get_user
    if not user_id or not endpoint:
        return {'success': False, 'message': '구독 정보가 올바르지 않습니다.', 'code': 400}

    user = get_user(user_id)
    if not user:
        return {'success': True}      # 이미 없으면 성공으로 본다
    subs = [s for s in (user.get('push_subs') or []) if s.get('endpoint') != endpoint]
    update_user_attrs(user_id, {'push_subs': subs})
    return {'success': True, 'count': len(subs)}
