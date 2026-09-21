import { useState } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { deleteDocument, setDocumentCompleted } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import { CheckCircle, Trash } from '../icons';

export default function CompletedPage({ onNavTo, toast }) {
  const { docs: allDocs, loading, error, reload } = useDocuments();
  const [hidden, setHidden] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null); // docId
  const [deleting, setDeleting] = useState(false);
  const [reopeningId, setReopeningId] = useState(null);

  const handleReopen = async (docId) => {
    setReopeningId(docId);
    try {
      const { data } = await setDocumentCompleted(docId, false);
      if (!data.success) throw new Error(data.message || '되돌리기 실패');
      toast('진행 중으로 되돌렸어요');
      await reload?.();
    } catch (e) {
      toast('되돌리기 실패: ' + (e.response?.data?.message || e.message));
    } finally {
      setReopeningId(null);
    }
  };

  // 완료 처리한 문서만
  const docs = allDocs.filter((d) => {
    if (hidden.includes(d.doc_id)) return false;
    return d.status === 'done' && d.completed;
  });

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const docId = deleteTarget;
    setDeleting(true);
    try {
      await deleteDocument(docId);
      setHidden((prev) => [...prev, docId]); // 즉시 숨김
      toast('삭제되었습니다');
      reload?.(); // 서버 목록 갱신
    } catch (e) {
      toast('삭제 실패: ' + (e.response?.data?.message || e.message));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <div className="doc-head">
        <div className="t-title">완료된 문서</div>
        <div className="t-body">완료 처리한 문서 목록입니다.</div>
      </div>

      {loading && <Skeleton rows={3} />}
      {error && <div className="card doc-error">{error}</div>}
      {!loading && !error && docs.length === 0 && (
        <EmptyState icon={CheckCircle} title="완료된 문서가 없습니다" desc="체크리스트를 끝내고 완료하면 여기에 모입니다." />
      )}

      <div className="doc-list">
        {docs.map((doc) => {
          const doneCount = doc.checks.filter((c) => c.done).length;
          const totalChecks = doc.checks.length || 1;
          const allDone = doneCount === doc.checks.length && doc.checks.length > 0;

          return (
            <Card key={doc.doc_id} className="doc-card doc-card-done">
              <div className="doc-card-head">
                <Chip tone="success">완료</Chip>
                <div className="doc-card-actions">
                  <span className="t-caption">{doc.deadlineDate || '마감일 미상'}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReopen(doc.doc_id)}
                    disabled={reopeningId === doc.doc_id}
                  >
                    {reopeningId === doc.doc_id ? '처리 중...' : '되돌리기'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Trash}
                    onClick={() => setDeleteTarget(doc.doc_id)}
                  >
                    삭제
                  </Button>
                </div>
              </div>
              <div className="doc-card-title">{doc.title}</div>
              <div className="t-caption doc-card-sub">업로드 {doc.upload} · 마감 {doc.deadlineDate || '-'}</div>
              <div className="doc-card-checks">
                {doc.checks.map((c, idx) => (
                  <div key={idx} className="doc-check-row doc-check-row-static">
                    <input type="checkbox" checked={c.done} disabled />
                    <span>{c.l}</span>
                  </div>
                ))}
              </div>
              <ProgressBar value={doneCount} total={totalChecks} />
              <div className="doc-card-progress-meta">
                <span className="t-caption">최종 준비 완료율</span>
                <span className={`t-caption doc-progress-count${allDone ? '' : ' doc-progress-incomplete'}`}>
                  {doneCount} / {doc.checks.length} · {Math.round((doneCount / totalChecks) * 100)}%
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="문서를 삭제할까요?"
        desc="선택한 문서를 영구 삭제합니다. 복구할 수 없어요."
        confirmLabel="삭제"
        cancelLabel="취소"
        tone="danger"
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
