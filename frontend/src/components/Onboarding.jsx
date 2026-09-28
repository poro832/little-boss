import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import { ONBOARD_STEPS, markOnboarded } from '../lib/onboarding';
import { Upload, Sparkle, Bell, Close } from '../icons';

const ICONS = { Upload, Sparkle, Bell };

// 처음 연 사용자에게 무엇부터 해야 하는지 3단계로 알려준다.
// 건너뛸 수 있어야 하고(강제하면 첫인상이 나빠진다), 한 번 본 뒤에는 다시 뜨지 않는다.
export default function Onboarding({ open, onClose, onGoUpload }) {
  const [step, setStep] = useState(0);
  const boxRef = useRef(null);
  const nextRef = useRef(null);

  useEffect(() => { if (open) setStep(0); }, [open]);
  useEffect(() => { if (open && nextRef.current) nextRef.current.focus(); }, [open]);

  const finish = (goUpload) => {
    markOnboarded();
    onClose();
    if (goUpload && onGoUpload) onGoUpload();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { finish(false); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      // 안내가 떠 있는 동안 뒤 화면으로 포커스가 새지 않게 가둔다.
      const items = boxRef.current.querySelectorAll('button:not([disabled])');
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const s = ONBOARD_STEPS[step];
  const Icon = ICONS[s.icon];
  const last = step === ONBOARD_STEPS.length - 1;

  return (
    <div className="dialog-backdrop" onClick={() => finish(false)}>
      <div
        ref={boxRef}
        className="onboard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="onboard-skip" onClick={() => finish(false)} aria-label="안내 건너뛰기">
          <Close size={16} />
        </button>

        <div className="onboard-icon">{Icon && <Icon size={30} />}</div>
        <div id="onboard-title" className="onboard-title">{s.title}</div>
        <div className="onboard-desc">{s.desc}</div>

        <div className="onboard-dots" aria-hidden="true">
          {ONBOARD_STEPS.map((_, i) => (
            <span key={i} className={`onboard-dot ${i === step ? 'onboard-dot-on' : ''}`} />
          ))}
        </div>

        <div className="onboard-actions">
          <Button variant="ghost" onClick={() => finish(false)}>건너뛰기</Button>
          <Button
            ref={nextRef}
            variant="primary"
            onClick={() => (last ? finish(true) : setStep(step + 1))}
          >
            {last ? '문서 올리러 가기' : '다음'}
          </Button>
        </div>
        <div className="onboard-step-text">{step + 1} / {ONBOARD_STEPS.length}</div>
      </div>
    </div>
  );
}
