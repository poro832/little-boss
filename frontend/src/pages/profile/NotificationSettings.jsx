import { useState } from 'react';
import { getUser } from '../../lib/auth';
import { updateNotifSettings } from '../../lib/api';
import Card from '../../components/Card';
import Toggle from '../../components/Toggle';

// LittleBoss.jsx:1929, 1931-2383 이관 (알림 토글 5종).
const DEFAULT_NOTIF = { deadline: true, incomplete: true, analysis: true, mail: true, weekly: false };

// 알림 설정은 세션 데이터가 아니므로(auth.js 관리 대상 아님) Header.jsx의 dismissed_notifs와
// 같은 방식으로 localStorage를 직접 읽고 쓴다.
const readNotif = () => {
  try { return { ...DEFAULT_NOTIF, ...JSON.parse(localStorage.getItem('notif_settings') || '{}') }; }
  catch { return DEFAULT_NOTIF; }
};

const PUSH_ITEMS = [
  ['마감 임박 알림', '마감 7일·3일·1일 전 알림', 'deadline'],
  ['서류 미완료 리마인더', '미준비 서류가 있을 때 알림', 'incomplete'],
  ['문서 분석 완료 알림', '업로드 문서 분석이 끝나면 알림', 'analysis'],
];

const MAIL_ITEMS = [
  ['메일 알림 받기', '이메일로 마감 일정 알림 수신', 'mail'],
  ['주간 요약 메일', '매주 월요일 이번 주 마감 일정 요약', 'weekly'],
];

export default function NotificationSettings({ toast }) {
  const user = getUser();
  const [notif, setNotif] = useState(readNotif);

  const toggleNotif = async (key) => {
    const next = { ...notif, [key]: !notif[key] };
    setNotif(next);
    try { localStorage.setItem('notif_settings', JSON.stringify(next)); } catch { /* 차단 환경 */ }
    try { await updateNotifSettings(user.id, next); } catch { /* 로컬엔 저장됨 — 무음 처리 */ }
  };

  const renderRow = ([label, sub, key]) => (
    <div key={key} className="notif-row">
      <div>
        <div className="t-body notif-row-label">{label}</div>
        <div className="t-caption">{sub}</div>
      </div>
      <Toggle checked={notif[key]} onChange={() => toggleNotif(key)} label={label} />
    </div>
  );

  return (
    <div className="profile-panel">
      <Card title="푸시 알림" className="profile-section">
        {PUSH_ITEMS.map(renderRow)}
      </Card>
      <Card title="메일 알림" className="profile-section">
        {MAIL_ITEMS.map(renderRow)}
        <div className="t-caption profile-notif-footer">변경 시 자동 저장됩니다 · 수신 이메일: {user.email || '-'}</div>
      </Card>
    </div>
  );
}
