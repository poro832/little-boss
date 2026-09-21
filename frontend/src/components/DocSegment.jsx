import { useIsMobile } from '../lib/useIsMobile';

// 모바일에는 사이드바가 없고 하단 탭의 "문서" 하나가 진행 중·완료 두 화면을 대표한다.
// 이 세그먼트가 없으면 완료된 문서로 갈 방법이 사라진다.
const ITEMS = [
  ['sub-ongoing', '진행 중'],
  ['sub-completed', '완료'],
];

export default function DocSegment({ current, onNavTo }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;   // 데스크톱은 사이드바로 이동한다

  return (
    <div className="seg" role="tablist" aria-label="문서 구분">
      {ITEMS.map(([id, label]) => {
        const on = current === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`seg-item ${on ? 'seg-item-on' : ''}`}
            onClick={() => !on && onNavTo(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
