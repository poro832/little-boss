import { useState } from 'react';
import ProfileInfo from './ProfileInfo';
import NotificationSettings from './NotificationSettings';
import Connections from './Connections';

// LittleBoss.jsx:1931-2383 이관. 453줄 단일 컴포넌트를 탭 전환만 하는 셸과
// 세 개의 독립 패널(ProfileInfo/NotificationSettings/Connections)로 분리한다.
const TABS = [
  ['profile', '프로필'],
  ['notifications', '알림 설정'],
  ['connections', '연결된 서비스'],
];

export default function ProfilePage({ toast, onLogout }) {
  const [tab, setTab] = useState('profile');

  return (
    <div>
      <div className="doc-head">
        <div className="t-title">내 정보</div>
        <div className="t-body">계정 정보와 알림 설정을 관리하세요.</div>
      </div>

      <div className="profile-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`profile-tab ${tab === id ? 'profile-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileInfo toast={toast} />}
      {tab === 'notifications' && <NotificationSettings toast={toast} />}
      {tab === 'connections' && <Connections toast={toast} onLogout={onLogout} />}
    </div>
  );
}
