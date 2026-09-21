import { Home, Upload, Calendar, ListCheck, User } from '../icons';

// 모바일에서는 햄버거 서랍 대신 하단 탭으로 이동한다.
// 서랍은 웹 패턴이고, 하단 탭이 "앱이다"라는 신호를 가장 강하게 준다.
//
// 진행 중 / 완료된 문서는 탭 하나(문서)로 합치고, 그 안에서 전환하게 한다.
// 탭이 5개를 넘으면 390px 폭에서 글자가 잘린다.
const TABS = [
  ['sub-home', Home, '홈'],
  ['sub-upload', Upload, '업로드'],
  ['sub-schedule', Calendar, '일정'],
  ['sub-ongoing', ListCheck, '문서'],
  ['sub-profile', User, '내 정보'],
];

// 문서 탭은 진행 중·완료 두 화면을 대표한다.
const TAB_FOR = { 'sub-completed': 'sub-ongoing' };

export default function BottomTabs({ currentSub, onNavTo }) {
  const active = TAB_FOR[currentSub] || currentSub;

  return (
    <nav className="tabbar" aria-label="주요 화면">
      {TABS.map(([id, Icon, label]) => {
        const on = active === id;
        return (
          <button
            key={id}
            type="button"
            className={`tabbar-item ${on ? 'tabbar-item-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => onNavTo(id)}
          >
            <Icon size={21} />
            <span className="tabbar-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
