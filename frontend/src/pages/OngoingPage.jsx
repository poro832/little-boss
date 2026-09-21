import { useState } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { formatDeadline, deadlineTone } from '../lib/format';
import { deleteDocument, updateChecklistItem, setDocumentCompleted } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import { ListCheck, Trash, ChevronRight } from '../icons';

// dday 칩 톤: deadlineTone() 결과 → Chip tone
const DDAY_CHIP_TONE = { none: 'neutral', past: 'neutral', urgent: 'danger', normal: 'brand' };

export default function OngoingPage({ onNavTo, toast }) {
  const { docs, loading, error, reload } = useDocuments();
  const [checkState, setCheckState] = useState({}); // `${docId}::${name}` -> bool (낙관적 오버라이드)
  const [deletingId, setDeletingId] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, title }

  const handleComplete = async (docId) => {
    setCompletingId(docId);
    try {
      const { data } = await setDocumentCompleted(docId, true);
      if (!data.success) throw new Error(data.message || '완료 처리 실패');
      toast('완료 처리했어요');
      await reload?.();
    } catch (e) {
      toast('완료 처리 실패: ' + (e.response?.data?.message || e.message));
    } finally {
      setCompletingId(null);
    }
  };

  const requestDelete = (e, docId, title) => {
    e.stopPropagation();
    setDeleteTarget({ id: docId, title });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeletingId(id);
    try {
      await deleteDocument(id);
      reload?.();
    } catch (err) {
      toast('삭제 실패: ' + (err.response?.data?.message || err.message));
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  const cancelDelete = () => setDeleteTarget(null);

  // 진행 중 = 분석 완료(done) & 아직 완료 처리 안 함 (마감 지나도 완료 전엔 진행 중에 유지)
  const ongoing = docs.filter((d) => {
    if (d.status !== 'done') return d.status !== 'error'; // 처리중 문서도 표시
    return !d.completed;
  });

  const toggleCheck = async (docId, name, current) => {
    const key = `${docId}::${name}`;
    const next = !current;
    setCheckState((s) => ({ ...s, [key]: next })); // 즉시 반영
    try {
      const { data } = await updateChecklistItem(docId, name, next);
      if (!data.success) throw new Error(data.message || '저장 실패');
    } catch (e) {
      setCheckState((s) => ({ ...s, [key]: current })); // 롤백
      toast('체크리스트 저장 실패: ' + (e.response?.data?.message || e.message));
    }
  };

  return (
    <div>
      <div className="doc-head">
        <div className="t-body">준비 중인 서류를 체크리스트로 관리하세요.</div>
      </div>

      {loading && <Skeleton rows={3} />}
      {error && <div className="card doc-error">{error}</div>}
      {!loading && !error && ongoing.length === 0 && (
        <EmptyState
          icon={ListCheck}
          title="진행 중인 문서가 없습니다"
          desc="새 문서를 업로드하면 분석 후 여기에서 진행 상황을 관리할 수 있어요."
          actionLabel="문서 업로드"
          onAction={() => onNavTo('sub-upload')}
        />
      )}

      <div className="doc-list">
        {ongoing.map((doc) => {
          const checks = doc.checks.map((c) => {
            const key = `${doc.doc_id}::${c.l}`;
            return { ...c, done: key in checkState ? checkState[key] : c.done };
          });
          const doneCount = checks.filter((c) => c.done).length;
          const processing = doc.status !== 'done';
          const canComplete = doc.total === 0 || doneCount === doc.total;

          return (
            <Card key={doc.doc_id} className="doc-card" onClick={() => onNavTo('schedule-detail', doc.title)}>
              <div className="doc-card-head">
                <div className="doc-card-info">
                  <button
                    type="button"
                    className="doc-card-title"
                    onClick={(e) => { e.stopPropagation(); onNavTo('schedule-detail', doc.title); }}
                  >
                    {doc.title}
                  </button>
                  <div className="t-caption">업로드 {doc.upload} · {processing ? '분석 중' : '분석 완료'}</div>
                </div>
                <div className="doc-card-actions">
                  <Chip tone={DDAY_CHIP_TONE[deadlineTone(doc.deadlineDate)]}>
                    {doc.deadlineDate ? `마감 ${doc.deadlineDate} · ${formatDeadline(doc.deadlineDate)}` : '마감일 없음'}
                  </Chip>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => requestDelete(e, doc.doc_id, doc.title)}
                    disabled={deletingId === doc.doc_id}
                    title="삭제"
                    aria-label={`${doc.title} 삭제`}
                  >
                    <Trash size={15} />
                  </button>
                  <ChevronRight size={18} className="doc-card-chevron" />
                </div>
              </div>

              {processing ? (
                <div className="analyzing">
                  <span className="spinner" />
                  <span>AI가 분석 중입니다 · 보통 30초~2분 걸립니다</span>
                </div>
              ) : (
                <>
                  <div className="doc-card-checks">
                    {checks.map((c, idx) => (
                      <label key={idx} className="doc-check-row" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={c.done}
                          onChange={() => toggleCheck(doc.doc_id, c.l, c.done)}
                        />
                        <span className={c.done ? 'doc-check-done' : ''}>{c.l}</span>
                      </label>
                    ))}
                  </div>
                  <ProgressBar value={doneCount} total={doc.total} />
                  <div className="doc-card-progress-meta">
                    <span className="t-caption">서류 준비 현황</span>
                    <span className="t-caption doc-progress-count">{doneCount} / {doc.total} 완료</span>
                  </div>
                  <Button
                    variant="primary"
                    className="doc-complete-btn"
                    onClick={(e) => { e.stopPropagation(); handleComplete(doc.doc_id); }}
                    disabled={!canComplete || completingId === doc.doc_id}
                  >
                    {completingId === doc.doc_id
                      ? '완료 처리 중...'
                      : canComplete ? '완료 처리' : '서류를 모두 체크하면 완료할 수 있어요'}
                  </Button>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="문서를 삭제할까요?"
        desc={deleteTarget ? `'${deleteTarget.title}' 문서를 삭제합니다. 복구할 수 없어요.` : ''}
        confirmLabel="삭제"
        cancelLabel="취소"
        tone="danger"
        busy={!!deleteTarget && deletingId === deleteTarget.id}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
