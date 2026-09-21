import { useState, useEffect } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { useIsMobile } from '../lib/useIsMobile';
import { formatDeadlineWithLabel, deadlineTone } from '../lib/format';
import { updateChecklistItem, pollUntilDone, toScreenDoc } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { ArrowLeft, FileText, CheckCircle, Calendar } from '../icons';

export default function ScheduleDetailPage({ day, title, prevSub, onNavTo, toast }) {
  const isMobile = useIsMobile();
  const { docs: serverDocs, loading, reload } = useDocuments();
  const [checkState, setCheckState] = useState({}); // name -> bool (낙관적 오버라이드)
  const [reanalyzing, setReanalyzing] = useState(false);
  const [memo, setMemo] = useState('');
  const [savedAt, setSavedAt] = useState('');

  // title로 실제 문서 매칭 (day는 캘린더 셀 이동 정보로만 쓰이고 매칭에는 title을 쓴다)
  const matched = serverDocs.find((d) => d.title === title || d.filename === title);
  const docId = matched?.doc_id;
  const memoKey = docId ? `docMemo_${docId}` : null;

  // 메모 로드 (doc_id 기준 — 문서·일정 상세가 같은 메모 공유). 차단 환경에서도 화면이 깨지지 않도록 try/catch
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

  if (loading) return <Skeleton rows={2} />;
  if (!matched) {
    return (
      <div>
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={() => onNavTo(prevSub || 'sub-schedule')}>
          돌아가기
        </Button>
        <EmptyState icon={Calendar} title="일정을 찾을 수 없어요" />
      </div>
    );
  }

  // 체크리스트: 백엔드(matched.checks) 기준 + 낙관적 오버라이드
  const mergedChecks = (matched.checks || []).map((c) => ({
    name: c.l,
    done: c.l in checkState ? checkState[c.l] : c.done,
  }));
  const total = mergedChecks.length;
  const completedCount = mergedChecks.filter((c) => c.done).length;

  const toggleCheck = async (name, current) => {
    const next = !current;
    setCheckState((s) => ({ ...s, [name]: next })); // 즉시 반영
    try {
      const { data: res } = await updateChecklistItem(docId, name, next);
      if (!res.success) throw new Error(res.message || '저장 실패');
    } catch (e) {
      setCheckState((s) => ({ ...s, [name]: current })); // 롤백
      toast('체크리스트 저장 실패: ' + (e.response?.data?.message || e.message));
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const fresh = await pollUntilDone(docId);
      const freshScreenDoc = toScreenDoc(fresh);
      setCheckState({});
      await reload?.();
      // pollUntilDone은 기존 분석 결과를 다시 읽어올 뿐, 재분석을 트리거하지 않는다.
      // 그 사이 분석이 끝나 있었다면 성공, 여전히 실패 상태면 그대로 알린다 — 거짓 성공 토스트 금지.
      if (freshScreenDoc.extractionFailed) {
        toast('서류 목록을 다시 불러왔지만 여전히 추출하지 못했어요. 문서를 다시 올려보세요.');
      } else {
        toast('다시 분석했어요');
      }
    } catch (e) {
      toast('다시 불러오기 실패: ' + (e.response?.data?.message || e.message));
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
          <div className="t-title">{matched.title}</div>
          <div className="detail-meta">마감 {matched.deadlineDate || '마감일 없음'}</div>
        </div>
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={() => onNavTo(prevSub || 'sub-schedule')}>
          돌아가기
        </Button>
      </div>

      {/* D-day 배지 */}
      <div className="detail-dday">
        <Chip tone={deadlineTone(matched.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
          {formatDeadlineWithLabel(matched.deadlineDesc, matched.deadlineDate)}
        </Chip>
      </div>

      {/* 내용 그리드 */}
      <div className={`detail-grid${isMobile ? ' detail-grid-mobile' : ''}`}>
        <Card title="일정 요약">
          <div className="detail-summary-text">{matched.summary || '요약 정보가 없습니다.'}</div>
        </Card>

        <Card title="필요 서류" actions={total > 0 && <span className="t-caption">체크 시 자동 저장</span>}>
          {total === 0 ? (
            matched.extractionFailed ? (
              <EmptyState
                icon={FileText}
                title="서류 목록을 추출하지 못했어요"
                desc="문서가 스캔본이거나 형식이 특이할 때 발생합니다. 다시 불러오면 그 사이 분석이 끝났는지 확인할 수 있어요."
                actionLabel={reanalyzing ? '다시 불러오는 중...' : '다시 불러오기'}
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
          placeholder="이 일정에 대한 메모를 작성하세요..."
        />
      </Card>
    </div>
  );
}
