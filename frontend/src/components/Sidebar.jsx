import { useState } from 'react';
import { Home, Upload, Folder, Calendar, ListCheck, CheckCircle, ChevronDown } from '../icons';

const SUB_ITEMS = [
  ['sub-schedule', Calendar, '일정 관리'],
  ['sub-ongoing', ListCheck, '진행 중인 문서'],
  ['sub-completed', CheckCircle, '완료된 문서'],
];

// 컴포넌트 밖에 선언한다. 본문 안에 두면 렌더마다 새 컴포넌트 타입이 만들어져
// React가 버튼을 언마운트/재마운트하고 키보드 포커스가 날아간다.
function NavItem({ active, icon: Icon, label, onClick }) {
  return (
    <button
      className={`nav-item ${active ? 'nav-item-active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
}

export default function Sidebar({ currentSub, onNavTo, sidebarOpen }) {
  const [subOpen, setSubOpen] = useState(
    SUB_ITEMS.some(([id]) => id === currentSub)
  );
  const isDocsSub = SUB_ITEMS.some(([id]) => id === currentSub);

  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <NavItem active={currentSub === 'sub-home'} icon={Home} label="대시보드" onClick={() => onNavTo('sub-home')} />
      <NavItem active={currentSub === 'sub-upload'} icon={Upload} label="문서 업로드" onClick={() => onNavTo('sub-upload')} />
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
              aria-current={currentSub === id ? 'page' : undefined}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
