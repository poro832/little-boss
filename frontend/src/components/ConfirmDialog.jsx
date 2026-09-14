import { useEffect, useRef } from 'react';
import Button from './Button';

// 되돌릴 수 없는 동작의 단일 확인 경로.
// 기본 포커스는 취소에 둔다 — Enter를 눌렀을 때 삭제되지 않게.
export default function ConfirmDialog({
  open, title, desc, confirmLabel = '삭제', cancelLabel = '취소',
  tone = 'danger', busy = false, onConfirm, onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (open && cancelRef.current) cancelRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
