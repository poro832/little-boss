import { useState, useEffect } from 'react';
import logo from '../../logo.svg';
import { Bell, FileText, CheckCircle, Close, ChevronDown } from '../icons';
import { getUser } from '../lib/auth';
import { useDocuments } from '../lib/useDocuments';
import { useIsMobile } from '../lib/useIsMobile';
import { deadlineEvents } from '../lib/api';
import { deadlineInfo, formatDeadline } from '../lib/format';

// LittleBoss.jsx:546-743 이관. 이모지 노출 없음 — 아이콘 컴포넌트만 사용.
// 24 viewBox, stroke 1.8, 라인 아이콘 세트와 톤을 맞춘 로컬 메뉴 아이콘(햄버거).
const MenuIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

function dday(dateStr) {
  const info = deadlineInfo(dateStr);
  return { text: formatDeadline(dateStr), isPast: info.isPast, days: info.days };
}

export default function Header({ onLogout, onNavTo, sidebarOpen, setSidebarOpen }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dismissed_notifs') || '[]'); } catch { return []; }
  });
  const dismissNotif = (key, e) => {
    e.stopPropagation();
    setDismissed((prev) => {
      const next = [...new Set([...prev, key])];
      localStorage.setItem('dismissed_notifs', JSON.stringify(next));
      return next;
    });
  };
  const user = getUser();

  useEffect(() => {
    const saved = localStorage.getItem('profileImage');
    if (saved) setProfileImage(saved);

    // localStorage 변경 감지 (다른 탭)
    const handleStorageChange = () => {
      const updated = localStorage.getItem('profileImage');
      if (updated) setProfileImage(updated);
    };

    // 같은 탭에서의 변경 감지
    const handleProfileImageUpdated = (e) => {
      setProfileImage(e.detail);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('profileImageUpdated', handleProfileImageUpdated);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('profileImageUpdated', handleProfileImageUpdated);
    };
  }, []);

  const { docs: notifDocs } = useDocuments();
  const isMobile = useIsMobile();

  // 가장 임박한 마감(안 지난 것 중 D-day 최소) — 헤더 칩에 표시
  const upcoming = deadlineEvents(notifDocs.filter((d) => d.status === 'done'))
    .filter((e) => e.date && !dday(e.date).isPast)
    .map((e) => ({ d: { title: e.title, navTitle: e.navTitle, deadlineDate: e.date }, dd: dday(e.date) }))
    .sort((a, b) => a.dd.days - b.dd.days)[0] || null;

  const notificationsRaw = [];
  let nid = 1;
  // 마감 임박(D-7 이내, 안 지남) 문서 알림
  notifDocs
    .filter((d) => d.status === 'done' && d.deadlineDate)
    .map((d) => ({ d, dd: dday(d.deadlineDate) }))
    .filter(({ dd: d }) => !d.isPast && d.days !== null && d.days <= 7)
    .sort((a, b) => a.dd.days - b.dd.days)
    .forEach(({ d, dd: d2 }) => {
      const incomplete = d.checks.filter((c) => !c.done).length;
      notificationsRaw.push({
        id: nid++, key: `deadline:${d.doc_id}`, type: 'highlight', pinned: d2.days <= 3, icon: FileText,
        title: d.title,
        message: incomplete > 0 ? `마감 ${d2.text} · 미완료 서류 ${incomplete}건` : `마감 ${d2.text} · 서류 준비 완료`,
        time: d2.text,
        kind: 'deadline',
        doc: d,
      });
    });
  // 최근 분석 완료 문서 알림 (최대 3개)
  notifDocs.filter((d) => d.status === 'done').slice(0, 3).forEach((d) => {
    notificationsRaw.push({
      id: nid++, key: `analysis:${d.doc_id}`, title: d.title, message: '문서 분석이 완료되었습니다', time: d.upload, icon: CheckCircle,
      kind: 'analysis',
      doc: d,
    });
  });
  // dismiss(닫기)된 알림 제외
  let visibleNotifs = notificationsRaw.filter((n) => !dismissed.includes(n.key));
  const hasNotifs = visibleNotifs.length > 0; // 실제 알림 존재 여부 (벨 빨간 점 표시 기준)
  if (visibleNotifs.length === 0) {
    visibleNotifs = [{ id: 0, title: '알림 없음', message: '새로운 알림이 없습니다', time: '', icon: Bell, kind: 'empty' }];
  }
  const notifications = [...visibleNotifs.filter((n) => n.pinned), ...visibleNotifs.filter((n) => !n.pinned)];

  useEffect(() => {
    const h = () => { setProfileOpen(false); setNotifOpen(false); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  return (
    <div className="header">
      <button className="header-burger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="메뉴">
        <MenuIcon />
      </button>
      <button className="header-brand" onClick={() => onNavTo('sub-home')}>
        <img src={logo} alt="LittleBoss" className="header-logo" />
        LittleBoss
      </button>
      <div className="header-spacer" />
      <div className="header-actions">
        {!isMobile && (upcoming ? (() => {
          const urgent = upcoming.dd.days <= 3;
          const t = upcoming.d.title.length > 14 ? upcoming.d.title.slice(0, 14) + '…' : upcoming.d.title;
          return (
            <button
              className={`header-deadline-chip ${urgent ? 'header-deadline-chip-urgent' : ''}`}
              onClick={() => onNavTo('schedule-detail', upcoming.d.navTitle)}
              title={`${upcoming.d.title} · 마감 ${upcoming.d.deadlineDate}`}
            >
              {t} {upcoming.dd.text}
            </button>
          );
        })() : (
          <span className="header-deadline-empty">임박한 마감 없음</span>
        ))}
        <div className="header-dropdown-anchor">
          <button
            className="header-icon-btn"
            aria-label="알림"
            onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen); setProfileOpen(false); }}
          >
            <Bell size={17} />
            {hasNotifs && <span className="header-icon-dot" />}
          </button>
          {notifOpen && (
            <div className="notif-dropdown">
              <div className="notif-dropdown-head">알림</div>
              {notifications.length > 0 ? (
                notifications.map((notif) => {
                  const handleNotifClick = () => {
                    setNotifOpen(false);
                    if (notif.kind === 'deadline') {
                      onNavTo('schedule-detail', notif.doc.title);
                    } else if (notif.kind === 'analysis') {
                      onNavTo('doc-detail', null, notif.doc);
                    }
                  };
                  const clickable = notif.kind === 'deadline' || notif.kind === 'analysis';
                  const Icon = notif.icon;
                  return (
                    <div
                      key={notif.id}
                      onClick={clickable ? handleNotifClick : undefined}
                      className={`notif-item ${clickable ? 'notif-item-clickable' : ''} ${notif.type === 'highlight' ? 'notif-item-highlight' : ''} ${notif.pinned ? 'notif-item-pinned' : ''}`}
                    >
                      <Icon size={17} className="notif-item-icon" />
                      <div className="notif-item-body">
                        <div className="notif-item-title">{notif.title}</div>
                        <div className="notif-item-message">{notif.message}</div>
                        <div className="notif-item-time">{notif.time}</div>
                      </div>
                      {notif.kind !== 'empty' && (
                        <button className="notif-item-close" onClick={(e) => dismissNotif(notif.key, e)} title="알림 닫기" aria-label="알림 닫기">
                          <Close size={13} />
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="notif-empty">알림이 없습니다</div>
              )}
            </div>
          )}
        </div>
        <div className="header-dropdown-anchor">
          <button
            className="profile-trigger"
            onClick={(e) => { e.stopPropagation(); setProfileOpen((p) => !p); setNotifOpen(false); }}
          >
            <span className="profile-avatar">
              {profileImage ? (
                <img src={profileImage} className="profile-avatar-img" alt="" />
              ) : (
                (user.name || '사')[0]
              )}
            </span>
            <span className="profile-name">{user.name}</span>
            <ChevronDown size={13} className="profile-caret" />
          </button>
          {profileOpen && (
            <div className="profile-dropdown">
              {[
                { label: '내 정보', action: () => { onNavTo('sub-profile'); setProfileOpen(false); } },
                { label: '로그아웃', action: () => { onLogout(); setProfileOpen(false); }, danger: true },
              ].map((item) => (
                <button
                  key={item.label}
                  className={`profile-dropdown-item ${item.danger ? 'profile-dropdown-item-danger' : ''}`}
                  onClick={(e) => { e.stopPropagation(); item.action(); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
