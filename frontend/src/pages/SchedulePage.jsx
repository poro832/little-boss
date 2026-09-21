import { useState } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { useIsMobile } from '../lib/useIsMobile';
import { deadlineInfo, formatDeadline, deadlineTone } from '../lib/format';
import { deadlineEvents, deadlinesForMonth } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { Calendar, ChevronRight } from '../icons';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 범례에 있는 세 색만 쓴다. 알 수 없는 status가 들어오면 아무 배경도 칠하지 않는다.
const BG_MAP = { ongoing: 'var(--warning-soft)', completed: 'var(--success-soft)', incomplete: 'var(--danger-soft)' };
const COLOR_MAP = { ongoing: 'var(--warning)', completed: 'var(--success)', incomplete: 'var(--danger)' };

// dday 칩 톤: deadlineTone() 결과 → Chip tone
const DDAY_CHIP_TONE = { none: 'neutral', past: 'neutral', urgent: 'danger', normal: 'brand' };

export default function SchedulePage({ onNavTo }) {
  const { docs, loading, error } = useDocuments();
  const isMobile = useIsMobile();
  const now = new Date();
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth() + 1); // 1~12
  const prevMonth = () => { if (calM === 1) { setCalM(12); setCalY(calY - 1); } else setCalM(calM - 1); };
  const nextMonth = () => { if (calM === 12) { setCalM(1); setCalY(calY + 1); } else setCalM(calM + 1); };

  // 동적 캘린더 그리드
  const firstDow = new Date(calY, calM - 1, 1).getDay();
  const daysInM = new Date(calY, calM, 0).getDate();
  const grid = [];
  for (let i = 0; i < firstDow; i++) grid.push(null);
  for (let i = 1; i <= daysInM; i++) grid.push(i);

  const monthEvents = deadlinesForMonth(docs, calY, calM);
  const isToday = (d) => d === now.getDate() && calM === now.getMonth() + 1 && calY === now.getFullYear();

  // 실제 문서의 마감 일정 목록 (가까운 순)
  const scheduleList = deadlineEvents(docs)
    .map((e) => {
      const info = deadlineInfo(e.date);
      const dt = new Date(e.date);
      return {
        doc_id: e.doc_id,
        date: e.date,
        title: e.title,
        navTitle: e.navTitle,
        items: '· ' + (e.checks.map((c) => c.l).slice(0, 4).join(' · ') || '준비 서류 없음'),
        day: isNaN(dt) ? '-' : dt.getDate(),
        month: isNaN(dt) ? '' : MON[dt.getMonth()],
        dday: formatDeadline(e.date),
        ddayTone: deadlineTone(e.date),
        passed: info.isPast,
        sortKey: info.days === null ? 99999 : info.days,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey);

  return (
    <div>
      <div className="sched-head">
        <div>
          <div className="t-body">문서별 마감일을 한눈에 확인하세요.</div>
        </div>
        <Button variant="primary" icon={Calendar}>캘린더 동기화</Button>
      </div>

      <Card className="sched-cal-card">
        <div className="sched-cal-nav">
          <span className="sched-cal-month">{calY}년 {calM}월</span>
          <div className="sched-cal-nav-btns">
            <button onClick={prevMonth} className="sched-cal-nav-btn" aria-label="이전 달">
              <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button onClick={nextMonth} className="sched-cal-nav-btn" aria-label="다음 달">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="sched-grid">
          {DOW.map((d) => <div key={d} className="sched-dow">{d}</div>)}
          {grid.map((d, i) => {
            const ev = d ? monthEvents[d] : null;
            const today = !!(d && isToday(d));
            const bg = ev && BG_MAP[ev.status] ? BG_MAP[ev.status] : (today ? 'var(--today-soft)' : 'transparent');
            const color = ev && COLOR_MAP[ev.status] ? COLOR_MAP[ev.status] : (today ? 'var(--today)' : 'var(--text-muted)');
            return (
              <div
                key={i}
                title={ev ? ev.title : ''}
                role={ev ? 'button' : undefined}
                tabIndex={ev ? 0 : undefined}
                aria-label={ev ? `${d}일 ${ev.title}` : undefined}
                onClick={() => ev && onNavTo('schedule-detail', ev.navTitle)}
                onKeyDown={(e) => {
                  if (ev && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onNavTo('schedule-detail', ev.navTitle);
                  }
                }}
                className={`sched-cell${isMobile ? ' sched-cell-compact' : ''}${ev ? ' sched-cell-has-event' : ''}`}
                style={{ background: bg, color, fontWeight: ev || today ? 700 : 400 }}
              >
                <span className="sched-cell-day">{d || ''}</span>
                {ev && !isMobile && <span className="sched-cell-title" style={{ color }}>{ev.title}</span>}
                {ev && isMobile && <span className="sched-cell-dot" style={{ background: color }} />}
              </div>
            );
          })}
        </div>

        <div className="sched-legend">
          <div className="sched-legend-item"><span className="sched-legend-dot" style={{ background: 'var(--warning)' }} />진행중</div>
          <div className="sched-legend-item"><span className="sched-legend-dot" style={{ background: 'var(--success)' }} />완료</div>
          <div className="sched-legend-item"><span className="sched-legend-dot" style={{ background: 'var(--danger)' }} />미완료</div>
        </div>
      </Card>

      <div className="t-eyebrow sched-list-heading">마감 일정 목록</div>
      {loading && <Skeleton rows={3} />}
      {error && <div className="card sched-error">{error}</div>}
      {!loading && !error && scheduleList.length === 0 && (
        <EmptyState
          icon={Calendar}
          title="마감 일정이 없습니다"
          desc="문서를 업로드하면 마감 일정이 자동으로 정리됩니다."
          actionLabel="문서 업로드"
          onAction={() => onNavTo('sub-upload')}
        />
      )}
      <div className="sched-list">
        {scheduleList.map((item) => (
          <button
            key={`${item.doc_id}_${item.date}`}
            type="button"
            onClick={() => onNavTo('schedule-detail', item.navTitle)}
            className="sched-list-item"
          >
            <div className={`sched-list-date${item.passed ? ' sched-list-date-passed' : ''}`}>
              <div className="sched-list-date-month">{item.month}</div>
              <div className="sched-list-date-day">{item.day}</div>
            </div>
            <div className="sched-list-body">
              <div className="sched-list-title">{item.title}</div>
              <div className="t-caption">{item.items}</div>
            </div>
            <Chip tone={DDAY_CHIP_TONE[item.ddayTone]}>{item.dday}</Chip>
          </button>
        ))}
      </div>
    </div>
  );
}
