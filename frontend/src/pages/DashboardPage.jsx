import { useState, useEffect } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { deadlineInfo, formatDeadline, formatDeadlineWithLabel, deadlineTone, greeting } from '../lib/format';
import { getUser } from '../lib/auth';
import Card from '../components/Card';
import Chip from '../components/Chip';
import Button from '../components/Button';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { Calendar, ChevronRight, CheckCircle, FileText, Search } from '../icons';

const STATUS_TONE = { '완료': 'success', '진행 중': 'warning', '미완료': 'danger' };
const STATUS_OPTIONS = ['진행 중', '완료', '미완료'];

// 문서 표시 상태: 완료 처리됐거나 체크리스트를 다 채웠으면 완료, 마감이 지났으면 미완료, 그 외엔 진행 중
function docDisplayStatus(d) {
  const info = deadlineInfo(d.deadlineDate);
  const done = d.checks.filter((c) => c.done).length;
  const allDone = d.total > 0 && done === d.total;
  if (d.completed || allDone) return '완료';
  if (info.isPast) return '미완료';
  return '진행 중';
}

export default function DashboardPage({ onNavTo }) {
  const { docs, loading } = useDocuments();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // 필터 팝오버 바깥 클릭 시 닫기
  useEffect(() => {
    if (!filterOpen) return;
    const h = () => setFilterOpen(false);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [filterOpen]);

  // 초기 로딩 중에는 카드가 빈 채로 깜빡이지 않도록 스켈레톤 표시
  if (loading) return <Skeleton rows={3} />;

  // 마감 임박 문서: 마감 안 지난 것 중 D-day 가장 가까운 1개
  const hero = docs
    .filter((d) => d.status === 'done' && d.deadlineDate && !deadlineInfo(d.deadlineDate).isPast && !d.completed)
    .map((d) => ({ ...d, _days: deadlineInfo(d.deadlineDate).days ?? 99999 }))
    .sort((a, b) => a._days - b._days)[0] || null;
  const doneCount = hero ? hero.checks.filter((c) => c.done).length : 0;

  // 다음 마감 3건: 히어로에 쓴 문서는 제외
  const upcoming = docs
    .filter((d) => d.status === 'done' && d.deadlineDate && !deadlineInfo(d.deadlineDate).isPast && !d.completed)
    .filter((d) => !hero || d.doc_id !== hero.doc_id)
    .sort((a, b) => deadlineInfo(a.deadlineDate).days - deadlineInfo(b.deadlineDate).days);

  // 미완료 체크 항목을 문서 구분 없이 펼친다
  const todos = docs
    .filter((d) => d.status === 'done' && !d.completed)
    .flatMap((d) => d.checks.filter((c) => !c.done).map((c) => ({ label: c.l, doc: d })))
    .slice(0, 5);

  // 최근 분석된 문서: 검색어(문서명) + 상태 필터 적용
  const recentDocs = docs
    .filter((d) => d.status === 'done')
    .map((d) => ({ ...d, dispStatus: docDisplayStatus(d) }));
  const filtered = recentDocs.filter(
    (d) =>
      (!search.trim() || d.title.toLowerCase().includes(search.trim().toLowerCase())) &&
      (!statusFilter || d.dispStatus === statusFilter)
  );

  return (
    <div>
      <div className="dash-greeting">{greeting()}, {getUser().name}님</div>

      {hero ? (
        <section className="hero">
          <Chip tone={deadlineTone(hero.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
            {formatDeadlineWithLabel(hero.deadlineDesc, hero.deadlineDate)}
          </Chip>
          <h2 className="hero-title">{hero.title}</h2>
          <p className="hero-meta">{hero.deadlineDate}</p>
          <div className="hero-progress">
            <span className="t-caption">준비물 {doneCount} / {hero.total}</span>
            <ProgressBar value={doneCount} total={hero.total} />
          </div>
          <Button variant="primary" onClick={() => onNavTo('doc-detail', null, hero)}>
            체크리스트 열기
          </Button>
        </section>
      ) : (
        <Card>
          <EmptyState
            icon={Calendar}
            title="아직 다가오는 마감이 없어요"
            desc="문서를 올리면 마감일과 준비 서류를 자동으로 정리해 드립니다."
            actionLabel="문서 업로드"
            onAction={() => onNavTo('sub-upload')}
          />
        </Card>
      )}

      <div className="dash-cols">
        <Card title="다음 마감">
          {upcoming.length === 0 ? (
            <EmptyState icon={Calendar} title="다음 마감이 없어요" />
          ) : (
            <>
              {upcoming.slice(0, 3).map((d) => (
                <button key={d.doc_id} className="row-item" onClick={() => onNavTo('doc-detail', null, d)}>
                  <Chip tone={deadlineTone(d.deadlineDate) === 'urgent' ? 'danger' : 'brand'}>
                    {formatDeadline(d.deadlineDate)}
                  </Chip>
                  <span className="row-title">{d.title}</span>
                  <span className="t-caption">
                    미완료 {d.total - d.checks.filter((c) => c.done).length}건
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {upcoming.length > 3 && (
                <Button variant="ghost" size="sm" onClick={() => onNavTo('sub-schedule')}>
                  일정 관리에서 전체 보기
                </Button>
              )}
            </>
          )}
        </Card>

        <Card title="준비물 요약">
          {todos.length === 0 ? (
            <EmptyState icon={CheckCircle} title="챙길 서류가 없어요" />
          ) : (
            todos.map((t, i) => (
              <button key={i} className="row-item" onClick={() => onNavTo('doc-detail', null, t.doc)}>
                <span className="todo-box" />
                <span className="row-title">{t.label}</span>
                <span className="t-caption">{t.doc.title}</span>
              </button>
            ))
          )}
        </Card>
      </div>

      <Card>
        <div className="dash-recent-head">
          <div className="t-section">최근 분석된 문서</div>
          <div className="dash-recent-actions">
            <label className="dash-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="문서명 검색"
                aria-label="문서명 검색"
              />
            </label>
            <div className="dash-filter-anchor">
              <Button
                variant={statusFilter ? 'primary' : 'outline'}
                size="sm"
                onClick={(e) => { e.stopPropagation(); setFilterOpen((v) => !v); }}
              >
                필터{statusFilter ? ` · ${statusFilter}` : ''}
              </Button>
              {filterOpen && (
                <div className="dash-filter-pop" onClick={(e) => e.stopPropagation()}>
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      className="dash-filter-option"
                      onClick={() => { setStatusFilter(statusFilter === s ? null : s); setFilterOpen(false); }}
                    >
                      <Chip tone={STATUS_TONE[s]}>{s}</Chip>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          recentDocs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="아직 분석된 문서가 없어요"
              desc="문서를 올리면 마감일과 준비물이 여기에 정리됩니다."
              actionLabel="문서 업로드"
              onAction={() => onNavTo('sub-upload')}
            />
          ) : (
            <EmptyState icon={Search} title="조건에 맞는 문서가 없어요" desc="검색어나 필터를 바꿔보세요." />
          )
        ) : (
          filtered.map((d) => (
            <button key={d.doc_id} className="row-item" onClick={() => onNavTo('doc-detail', null, d)}>
              <FileText size={18} />
              <span className="row-title">{d.title}</span>
              <span className="t-caption">
                {d.upload}{d.deadlineDate ? ` · 마감 ${formatDeadline(d.deadlineDate)}` : ''}
              </span>
              <Chip tone={STATUS_TONE[d.dispStatus]}>{d.dispStatus}</Chip>
            </button>
          ))
        )}
      </Card>
    </div>
  );
}
