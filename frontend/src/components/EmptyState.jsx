import { Inbox } from '../icons';
import Button from './Button';

// 완료된 문서 화면에서 검증된 패턴. 모든 빈 상태는 이걸 쓴다.
export default function EmptyState({ icon: Icon = Inbox, title, desc, actionLabel, onAction }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={40} /></div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}
