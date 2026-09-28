import { useEffect, useRef } from 'react';
import Button from './Button';

// 되돌릴 수 없는 동작의 단일 확인 경로.
// 기본 포커스는 취소에 둔다 — Enter를 눌렀을 때 삭제되지 않게.
export default function ConfirmDialog({
  open, title, desc, confirmLabel = '삭제', cancelLabel = '취소',
  tone = 'danger', busy = false, onConfirm, onCancel,
}) {
  const cancelRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (open && cancelRef.current) cancelRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;

      // 포커스를 모달 안에 가둔다. 없으면 Tab으로 뒤 배경 버튼까지 이동해
      // 키보드 사용자가 가려진 요소를 조작할 수 있다.
      const items = boxRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div ref={boxRef} className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        {desc && <div className="dialog-desc">{desc}</div>}
        <div className="dialog-actions">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? '처리 중...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
