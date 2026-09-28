import { useState, useEffect } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { deadlineInfo, formatDeadline, deadlineTone, greeting } from '../lib/format';
import { getUser } from '../lib/auth';
import { cacheDeadlineSummary, readDeadlineSummary } from '../lib/push';
import { shouldShowOnboarding } from '../lib/onboarding';
import Onboarding from '../components/Onboarding';
import Card from '../components/Card';
import Chip from '../components/Chip';
import Button from '../components/Button';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { Calendar, ChevronRight, CheckCircle, FileText, Search, Sparkle, Upload } from '../icons';

const STATUS_TONE = { '완료': 'success', '진행 중': 'warning', '미완료': 'danger' };
const STATUS_OPTIONS = ['진행 중', '완료', '미완료'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 마감이 남아 있고 아직 끝내지 않은 문서. 히어로·다음마감·오프라인 요약이 같은 기준을 쓴다.
const isUpcoming = (d) =>
  d.status === 'done' && d.deadlineDate && !deadlineInfo(d.deadlineDate).isPast && !d.completed;
const daysLeft = (d) => deadlineInfo(d.deadlineDate).days ?? 99999;
const doneOf = (d) => d.checks.filter((c) => c.done).length;

// 문서 표시 상태: 완료 처리됐거나 체크리스트를 다 채웠으면 완료, 마감이 지났으면 미완료, 그 외엔 진행 중
function docDisplayStatus(d) {
  const info = deadlineInfo(d.deadlineDate);
  const allDone = d.total > 0 && doneOf(d) === d.total;
  if (d.completed || allDone) return '완료';
  if (info.isPast) return '미완료';
  return '진행 중';
}

// 상단 날짜 라벨 — "9월 28일 월요일"
function todayLabel() {
  const n = new Date();
  return `${n.getMonth() + 1}월 ${n.getDate()}일 ${DOW[n.getDay()]}요일`;
}

// 팁은 고정 문구를 날짜로 돌린다. 매번 같은 문장이면 배너가 배경처럼 읽힌다.
const TIPS = [
  '가족관계증명서는 정부24에서 온라인으로 발급할 수 있어요.',
  '재학증명서는 학교 포털에서 즉시 출력되는 경우가 많아요.',
  '마감 하루 전에는 제출처의 접수 시간을 한 번 더 확인해 보세요.',
  '스캔본이 흐리면 분석 정확도가 떨어져요. 밝은 곳에서 찍어주세요.',
];

export default function DashboardPage({ onNavTo }) {
  const { docs, loading, error } = useDocuments();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  // 처음 연 사용자에게만 1회. 판단은 lib/onboarding 이 한다.
  const [showOnboard, setShowOnboard] = useState(() => shouldShowOnboarding());

  // 필터 팝오버 바깥 클릭 시 닫기
  useEffect(() => {
    if (!filterOpen) return;
    const h = () => setFilterOpen(false);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [filterOpen]);

  // 조회에 성공할 때마다 마감 요약을 남겨둔다. 오프라인에서 앱을 열면 이걸 보여준다.
  useEffect(() => {
    if (loading || error) return;
    cacheDeadlineSummary(
      docs.filter(isUpcoming).sort((a, b) => daysLeft(a) - daysLeft(b))
        .map((d) => ({ title: d.title, date: d.deadlineDate, doc_id: d.doc_id }))
    );
  }, [docs, loading, error]);

  if (loading) return <Skeleton rows={3} />;

  // 네트워크가 끊겨 아무것도 못 받았으면 마지막으로 저장한 요약을 보여준다.
  if (error && docs.length === 0) {
    const cached = readDeadlineSummary();
    if (cached.items.length > 0) {
      return (
        <div>
          <div className="dash-date">{todayLabel()}</div>
          <h2 className="dash-hello">{greeting()}, {getUser().name}님</h2>
          <Card title="오프라인 · 마지막으로 저장된 마감" className="offline-card">
            <div className="t-caption offline-synced">
              {new Date(cached.syncedAt).toLocaleString('ko-KR')} 기준 · 이후 변경은 반영되지 않았습니다
            </div>
            {cached.items.map((it) => (
              <div key={it.doc_id || it.title} className="offline-row">
                <span className="t-body">{it.title}</span>
                <Chip tone={deadlineTone(it.date) === 'urgent' ? 'danger' : 'brand'}>
                  {formatDeadline(it.date)}
                </Chip>
              </div>
            ))}
          </Card>
        </div>
      );
    }
  }

  const live = docs.filter(isUpcoming).sort((a, b) => daysLeft(a) - daysLeft(b));
  const hero = live[0] || null;
  const upcoming = live.slice(1);

  // 관리 중: 분석이 끝났고 아직 완료 처리하지 않은 문서
  const managed = docs.filter((d) => d.status === 'done' && !d.completed);
  const thisMonth = new Date().toISOString().slice(0, 7).replace('-', '.');
  const addedThisMonth = docs.filter((d) => (d.upload || '').startsWith(thisMonth)).length;

  // 준비 완료: 모든 관리 대상 문서의 체크 항목을 합산
  const checkTotal = managed.reduce((s, d) => s + d.total, 0);
  const checkDone = managed.reduce((s, d) => s + doneOf(d), 0);
  const checkPct = checkTotal ? Math.round((checkDone / checkTotal) * 100) : 0;

  // 히어로 문서의 준비 현황
  const heroDone = hero ? doneOf(hero) : 0;
  const heroPct = hero && hero.total ? Math.round((heroDone / hero.total) * 100) : 0;
  const heroMissing = hero ? hero.total - heroDone : 0;

  const recentDocs = docs
    .filter((d) => d.status === 'done')
    .map((d) => ({ ...d, dispStatus: docDisplayStatus(d) }));
  const filtered = recentDocs.filter(
    (d) =>
      (!search.trim() || d.title.toLowerCase().includes(search.trim().toLowerCase())) &&
      (!statusFilter || d.dispStatus === statusFilter)
  );

  const tip = TIPS[new Date().getDate() % TIPS.length];

  return (
    <div>
      <Onboarding
        open={showOnboard}
        onClose={() => setShowOnboard(false)}
        onGoUpload={() => onNavTo('sub-upload')}
      />

      <header className="dash-head">
        <div>
          <div className="dash-date">{todayLabel()}</div>
          <h2 className="dash-hello">{greeting()}, {getUser().name}님</h2>
          <p className="dash-sub">
            {live.length > 0
              ? `오늘 챙겨야 할 일정이 ${live.length}개 있어요.`
              : '지금은 다가오는 마감이 없어요.'}
          </p>
        </div>
        <Button variant="primary" icon={Upload} onClick={() => onNavTo('sub-upload')}>
          새 문서 분석
        </Button>
      </header>

      {/* 가장 중요한 하나(가장 가까운 마감)만 채운 면으로 강조하고 나머지는 물러난다 */}
      <div className="stat-row">
        {hero ? (
          <button
            type="button"
            className="stat stat-hero"
            onClick={() => onNavTo('doc-detail', null, hero)}
          >
            <span className="stat-label">가장 가까운 마감</span>
            <span className="stat-value">{formatDeadline(hero.deadlineDate)}</span>
            <span className="stat-note">{hero.title}</span>
            <ChevronRight size={18} className="stat-arrow" />
          </button>
        ) : (
          <div className="stat stat-quiet">
            <span className="stat-label">가장 가까운 마감</span>
            <span className="stat-value">—</span>
            <span className="stat-note">등록된 마감이 없어요</span>
          </div>
        )}

        <div className="stat">
          <span className="stat-icon stat-icon-doc"><FileText size={18} /></span>
          <span className="stat-label">관리 중인 문서</span>
          <span className="stat-value">{managed.length}</span>
          <span className="stat-note">
            {addedThisMonth > 0 ? `이번 달 ${addedThisMonth}개 추가` : '이번 달 추가 없음'}
          </span>
        </div>

        <div className="stat">
          <span className="stat-icon stat-icon-check"><CheckCircle size={18} /></span>
          <span className="stat-label">준비 완료</span>
          <span className="stat-value">{checkDone}</span>
          <span className="stat-note">
            {checkTotal ? `전체 항목의 ${checkPct}%` : '준비할 항목이 없어요'}
          </span>
        </div>
      </div>

      <div className="dash-cols">
        <Card
          title="다가오는 일정"
          actions={
            live.length > 0 && (
              <button type="button" className="card-link" onClick={() => onNavTo('sub-schedule')}>
                전체 보기 <ChevronRight size={14} />
              </button>
            )
          }
        >
          {live.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="아직 다가오는 마감이 없어요"
              desc="문서를 올리면 마감일과 준비 서류를 자동으로 정리해 드립니다."
              actionLabel="문서 업로드"
              onAction={() => onNavTo('sub-upload')}
            />
          ) : (
            <>
              <div className="t-caption sched-hint">놓치면 안 되는 순서로 정리했어요.</div>
              {live.slice(0, 4).map((d) => {
                const dt = new Date(d.deadlineDate);
                const urgent = deadlineTone(d.deadlineDate) === 'urgent';
                const left = d.total - doneOf(d);
                return (
                  <button
                    key={d.doc_id}
                    type="button"
                    className="sched-row"
                    onClick={() => onNavTo('doc-detail', null, d)}
                  >
                    <span className={`sched-date ${urgent ? 'sched-date-urgent' : ''}`}>
                      <span className="sched-date-m">{MON[dt.getMonth()]}</span>
                      <span className="sched-date-d">{dt.getDate()}</span>
                    </span>
                    <span className="sched-body">
                      <span className="sched-title">{d.title}</span>
                      <span className="t-caption">{d.deadlineDesc || `${d.deadlineDate} 마감`}</span>
                    </span>
                    <span className="sched-right">
                      <span className={`sched-dday ${urgent ? 'sched-dday-urgent' : ''}`}>
                        {formatDeadline(d.deadlineDate)}
                      </span>
                      <span className="t-caption">
                        {d.total === 0 ? '준비물 없음'
                          : left === 0 ? '준비 완료'
                            : `준비 ${doneOf(d)}/${d.total}`}
                      </span>
                    </span>
                  </button>
                );
              })}
              {upcoming.length > 3 && (
                <div className="sched-more t-caption">외 {upcoming.length - 3}건이 더 있어요</div>
              )}
            </>
          )}
        </Card>

        <Card
          title="준비 현황"
          actions={hero && <span className="prep-pct">{heroPct}%</span>}
        >
          {!hero ? (
            <EmptyState icon={CheckCircle} title="챙길 서류가 없어요" />
          ) : (
            <>
              <div className="t-caption prep-doc">{hero.title}</div>
              <ProgressBar value={heroDone} total={hero.total} />
              <div className="prep-msg">
                {hero.total === 0 ? '이 문서에는 준비물이 없어요.'
                  : heroMissing === 0 ? '준비물을 모두 챙겼어요.'
                    : `서류 ${heroMissing}개를 더 준비해주세요.`}
              </div>
              <div className="prep-list">
                {hero.checks.slice(0, 5).map((c, i) => (
                  <div key={`${hero.doc_id}-${c.l}-${i}`} className="prep-item">
                    <span className={`prep-box ${c.done ? 'prep-box-on' : ''}`}>
                      {c.done && <CheckCircle size={12} />}
                    </span>
                    <span className={`prep-name ${c.done ? 'prep-name-done' : ''}`}>{c.l}</span>
                    {!c.done && <span className="prep-need">준비 필요</span>}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => onNavTo('doc-detail', null, hero)}>
                체크리스트 열기
              </Button>
            </>
          )}
        </Card>
      </div>

      <div className="tip-banner">
        <span className="tip-icon"><Sparkle size={16} /></span>
        <span className="tip-label">리틀보스 팁</span>
        <span className="tip-text">{tip}</span>
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
