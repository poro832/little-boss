import { useState, useEffect } from 'react';
import { useIsMobile } from '../lib/useIsMobile';
import { formatDeadlineWithLabel, deadlineTone } from '../lib/format';
import { updateChecklistItem, pollUntilDone, toScreenDoc } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import { ArrowLeft, FileText, CheckCircle } from '../icons';

export default function DocumentDetailPage({ data, prevSub, onNavTo, toast }) {
  const isMobile = useIsMobile();
  const [screenDoc, setScreenDoc] = useState(data);
  const [checkState, setCheckState] = useState({}); // name -> bool (낙관적 오버라이드)
  const [reanalyzing, setReanalyzing] = useState(false);
  const [memo, setMemo] = useState('');
  const [savedAt, setSavedAt] = useState('');

  // 상세로 새로 진입하면(다른 문서로 이동) 최신 prop으로 동기화
  useEffect(() => { setScreenDoc(data); }, [data]);

  const doc = screenDoc;
  const memoKey = doc ? `docMemo_${doc.doc_id}` : null;

  // 메모 로드 (doc_id 기준 — 차단 환경에서도 화면이 깨지지 않도록 try/catch)
  useEffect(() => {
    if (!memoKey) { setMemo(''); setSavedAt(''); return; }
    try {
      setMemo(localStorage.getItem(memoKey) || '');
      setSavedAt(localStorage.getItem(`${memoKey}:at`) || '');
    } catch {
      setMemo('');
      setSavedAt('');
    }
  }, [memoKey]);

  if (!doc) return <EmptyState icon={FileText} title="문서를 찾을 수 없어요" />;

  // 체크리스트는 백엔드(doc.checks)를 기준으로 표시, checkState로 낙관적 오버라이드
  const mergedChecks = (doc.checks || []).map((c) => ({
    name: c.l,
    done: c.l in checkState ? checkState[c.l] : c.done,
  }));
  const total = mergedChecks.length;
  const completedCount = mergedChecks.filter((c) => c.done).length;

  const toggleCheck = async (name, current) => {
    const next = !current;
    setCheckState((s) => ({ ...s, [name]: next })); // 즉시 반영
    try {
      const { data: res } = await updateChecklistItem(doc.doc_id, name, next);
      if (!res.success) throw new Error(res.message || '저장 실패');
    } catch (e) {
      setCheckState((s) => ({ ...s, [name]: current })); // 롤백
      toast('체크리스트 저장 실패: ' + (e.response?.data?.message || e.message));
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const fresh = await pollUntilDone(doc.doc_id);
      setScreenDoc(toScreenDoc(fresh));
      setCheckState({});
      toast('다시 분석했어요');
    } catch (e) {
      toast('다시 분석 실패: ' + (e.response?.data?.message || e.message));
    } finally {
      setReanalyzing(false);
    }
  };

  const saveMemo = () => {
    const now = new Date().toISOString();
    try {
      if (memoKey) {
        localStorage.setItem(memoKey, memo);
        localStorage.setItem(`${memoKey}:at`, now);
      }
    } catch {
      /* 차단 환경 — 저장은 실패해도 화면은 계속 동작 */
    }
    setSavedAt(now);
    toast('메모를 저장했어요');
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="detail-head">
        <div>
          <div className="t-title">{doc.title}</div>
          <div className="detail-meta">업로드 {doc.upload}{doc.deadlineDate ? ` · 마감 ${doc.deadlineDate}` : ''}</div>
        </div>
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={() => onNavTo(prevSub || 'sub-home')}>
          돌아가기
        </Button>
      </div>

      {/* D-day 배지 */}
      <div className="detail-dday">
        <Chip tone={deadlineTone(doc.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
          {formatDeadlineWithLabel(doc.deadlineDesc, doc.deadlineDate)}
        </Chip>
      </div>

      {/* 내용 그리드 */}
      <div className={`detail-grid${isMobile ? ' detail-grid-mobile' : ''}`}>
        <Card title="문서 요약">
          <div className="detail-summary-text">{doc.summary || '요약 정보가 없습니다.'}</div>
        </Card>

        <Card title="필요 서류" actions={total > 0 && <span className="t-caption">체크 시 자동 저장</span>}>
          {total === 0 ? (
            doc.extractionFailed ? (
              <EmptyState
                icon={FileText}
                title="서류 목록을 추출하지 못했어요"
                desc="문서가 스캔본이거나 형식이 특이할 때 발생합니다. 다시 분석해 보세요."
                actionLabel={reanalyzing ? '다시 분석 중...' : '다시 분석하기'}
                onAction={reanalyzing ? undefined : handleReanalyze}
              />
            ) : (
              <EmptyState icon={CheckCircle} title="제출할 서류가 없는 문서예요" />
            )
          ) : (
            <>
              <div className="doc-card-checks">
                {mergedChecks.map((c, idx) => (
                  <label key={idx} className="doc-check-row">
                    <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.name, c.done)} />
                    <span className={c.done ? 'doc-check-done' : ''}>{c.name}</span>
                  </label>
                ))}
              </div>
              <ProgressBar value={completedCount} total={total} />
              <div className="doc-card-progress-meta">
                <span className="t-caption">준비율</span>
                <span className="t-caption doc-progress-count">{completedCount} / {total} 완료</span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* 메모 */}
      <Card
        title="메모"
        actions={(
          <div className="detail-memo-actions">
            {savedAt && <span className="t-caption">마지막 저장 {new Date(savedAt).toLocaleString('ko-KR')}</span>}
            <Button variant="primary" size="sm" onClick={saveMemo}>저장하기</Button>
          </div>
        )}
      >
        <textarea
          className="field-input memo-textarea"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="이 문서에 대한 메모를 작성하세요..."
        />
      </Card>
    </div>
  );
}
