import { useState, useEffect } from 'react';
import { getUser } from '../../lib/auth';
import { updateNotifSettings } from '../../lib/api';
import { pushSupport, enablePush, disablePush, sendDemoNotification } from '../../lib/push';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Toggle from '../../components/Toggle';
import HelpTip from '../../components/HelpTip';

// LittleBoss.jsx:1929, 1931-2383 이관 (알림 토글 5종).
const DEFAULT_NOTIF = { deadline: true, incomplete: true, analysis: true, mail: true, weekly: false };

// 알림 설정은 세션 데이터가 아니므로(auth.js 관리 대상 아님) Header.jsx의 dismissed_notifs와
// 같은 방식으로 localStorage를 직접 읽고 쓴다.
const readNotif = () => {
  try { return { ...DEFAULT_NOTIF, ...JSON.parse(localStorage.getItem('notif_settings') || '{}') }; }
  catch { return DEFAULT_NOTIF; }
};

const PUSH_ITEMS = [
  ['마감 임박 알림', '마감 7일·3일·1일 전 알림', 'deadline',
   `켜면 브라우저에 알림 권한을 요청합니다. 허용하면 앱을 열어두지 않아도 알림이 옵니다.

iPhone은 홈 화면에 추가한 뒤에만 동작합니다.`],
  ['서류 미완료 리마인더', '미준비 서류가 있을 때 알림', 'incomplete'],
  ['문서 분석 완료 알림', '업로드 문서 분석이 끝나면 알림', 'analysis'],
];

const MAIL_ITEMS = [
  ['메일 알림 받기', '이메일로 마감 일정 알림 수신', 'mail'],
  ['주간 요약 메일', '매주 월요일 이번 주 마감 일정 요약', 'weekly'],
];

// 켜기 실패 이유별 안내. 사용자가 다음에 뭘 해야 하는지까지 말해준다.
const FAIL_MESSAGE = {
  'needs-install': 'iPhone은 홈 화면에 추가한 뒤에야 알림을 받을 수 있어요. 공유 > 홈 화면에 추가 후 다시 켜주세요.',
  denied: '브라우저에서 알림이 차단되어 있어요. 주소창 옆 자물쇠 > 알림에서 허용으로 바꿔주세요.',
  unsupported: '이 브라우저는 알림을 지원하지 않아요. 아래 메일 알림을 대신 켜두세요.',
  'no-key': '마감 알림 서버는 준비 중이에요. 아래 "테스트 알림 보내기"로 알림이 어떻게 오는지 먼저 확인해 보세요.',
};

export default function NotificationSettings({ toast }) {
  const user = getUser();
  const [notif, setNotif] = useState(readNotif);
  const [support, setSupport] = useState({ supported: true, needsInstall: false, permission: 'default' });
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => { setSupport(pushSupport()); }, []);

  const persist = async (next) => {
    setNotif(next);
    try { localStorage.setItem('notif_settings', JSON.stringify(next)); } catch { /* 차단 환경 */ }
    try { await updateNotifSettings(user.id, next); } catch { /* 로컬엔 저장됨 — 무음 처리 */ }
  };

  const toggleNotif = async (key) => {
    const turningOn = !notif[key];

    // 마감 알림만 실제 푸시 구독과 연결된다. 권한 요청은 이 사용자 동작이 유일한 트리거다.
    if (key === 'deadline') {
      setBusy(true);
      try {
        const r = turningOn ? await enablePush(user.id) : await disablePush(user.id);
        if (!r.ok) {
          // 켜기에 실패했으면 토글을 되돌린다 — 켜진 것처럼 보이는데 안 오는 게 최악이다.
          setSupport(pushSupport());
          toast(FAIL_MESSAGE[r.reason] || '알림을 켜지 못했어요.');
          return;
        }
        setSupport(pushSupport());
      } finally {
        setBusy(false);
      }
    }

    await persist({ ...notif, [key]: turningOn });
  };

  const sendDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await sendDemoNotification();
      setSupport(pushSupport());
      if (!r.ok) toast(FAIL_MESSAGE[r.reason] || '알림을 보내지 못했어요.');
    } finally {
      setDemoBusy(false);
    }
  };

  const renderRow = ([label, sub, key, tip]) => (
    <div key={key} className="notif-row">
      <div>
        <div className="t-body notif-row-label">
          {label}
          {tip && <HelpTip label={label} text={tip} />}
        </div>
        <div className="t-caption">{sub}</div>
      </div>
      <Toggle
        checked={notif[key]}
        onChange={() => toggleNotif(key)}
        label={label}
        disabled={key === 'deadline' && busy}
      />
    </div>
  );

  // 켤 수 없는 상태라면 토글을 누르기 전에 미리 알려준다.
  const blocker =
    support.needsInstall ? FAIL_MESSAGE['needs-install']
      : !support.supported ? FAIL_MESSAGE.unsupported
        : support.permission === 'denied' ? FAIL_MESSAGE.denied
          : null;

  return (
    <div className="profile-panel">
      <Card title="푸시 알림" className="profile-section">
        {blocker && <div className="notif-blocker t-caption">{blocker}</div>}
        {PUSH_ITEMS.map(renderRow)}
        <div className="notif-demo">
          <div className="t-caption notif-demo-desc">
            알림이 어떻게 오는지 지금 바로 확인해 볼 수 있어요.
          </div>
          <Button variant="outline" size="sm" onClick={sendDemo} disabled={demoBusy}>
            {demoBusy ? '보내는 중...' : '테스트 알림 보내기'}
          </Button>
        </div>
      </Card>
      <Card title="메일 알림" className="profile-section">
        {MAIL_ITEMS.map(renderRow)}
        <div className="t-caption profile-notif-footer">변경 시 자동 저장됩니다 · 수신 이메일: {user.email || '-'}</div>
      </Card>
    </div>
  );
}
