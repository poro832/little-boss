import { useState } from 'react';
import { Home, Upload, Folder, Calendar, ListCheck, CheckCircle, User, ChevronDown } from '../icons';

const SUB_ITEMS = [
  ['sub-schedule', Calendar, '일정 관리'],
  ['sub-ongoing', ListCheck, '진행 중인 문서'],
  ['sub-completed', CheckCircle, '완료된 문서'],
];

export default function Sidebar({ currentSub, onNavTo, sidebarOpen }) {
  const [subOpen, setSubOpen] = useState(
    SUB_ITEMS.some(([id]) => id === currentSub)
  );
  const isDocsSub = SUB_ITEMS.some(([id]) => id === currentSub);

  const NavItem = ({ id, icon: Icon, label }) => {
    const active = currentSub === id;
    return (
      <button className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={() => onNavTo(id)}>
        <Icon size={17} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <NavItem id="sub-home" icon={Home} label="대시보드" />
      <NavItem id="sub-upload" icon={Upload} label="문서 업로드" />
      <button
        className={`nav-item ${isDocsSub ? 'nav-item-parent' : ''}`}
        onClick={() => setSubOpen((p) => !p)}
        aria-expanded={subOpen}
      >
        <Folder size={17} />
        <span>내 문서 관리</span>
        <ChevronDown size={16} className={`nav-caret ${subOpen ? 'nav-caret-open' : ''}`} />
      </button>
      {subOpen && (
        <div className="nav-sub">
          {SUB_ITEMS.map(([id, Icon, label]) => (
            <button
              key={id}
              className={`nav-item nav-item-sub ${currentSub === id ? 'nav-item-active' : ''}`}
              onClick={() => onNavTo(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      <NavItem id="sub-profile" icon={User} label="내 정보" />
    </aside>
  );
}
