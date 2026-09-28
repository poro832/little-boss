import { useEffect, useRef, useState } from 'react';

// 설명이 필요한 기능 옆에 붙는 작은 물음표.
// hover가 아니라 클릭으로 연다 — 터치 기기에는 hover가 없고, hover만으로 여는 설명은
// 키보드 사용자에게도 닿지 않는다.
export default function HelpTip({ label, text }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="helptip" ref={wrapRef}>
      <button
        type="button"
        className="helptip-btn"
        aria-label={`${label} 설명`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
      >
        ?
      </button>
      {open && <span className="helptip-pop" role="tooltip">{text}</span>}
    </span>
  );
}
