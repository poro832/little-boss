// 마감일 표기의 단일 진실 공급원.
// 화면에서 직접 날짜를 계산하거나 문자열을 조립하지 않는다.

const DAY_MS = 86400000;

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function deadlineInfo(dateStr) {
  if (!dateStr) return { hasDate: false, valid: false, days: null, isPast: false };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { hasDate: true, valid: false, days: null, isPast: false };
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  return { hasDate: true, valid: true, days, isPast: days < 0 };
}

export function formatDeadline(dateStr) {
  const info = deadlineInfo(dateStr);
  if (!info.hasDate) return '마감일 없음';
  if (!info.valid) return '마감일 미정';
  if (info.days === 0) return 'D-Day';
  if (info.days > 0) return `D-${info.days}`;
  // 과거: 부호를 절대 노출하지 않는다.
  return `${Math.abs(info.days)}일 지남`;
}

export function formatDeadlineWithLabel(label, dateStr) {
  const text = formatDeadline(dateStr);
  return label ? `${label} ${text}` : text;
}

export function deadlineTone(dateStr) {
  const info = deadlineInfo(dateStr);
  if (!info.hasDate || !info.valid) return 'none';
  if (info.isPast) return 'past';
  return info.days <= 3 ? 'urgent' : 'normal';
}

// LittleBoss.jsx:38-44에서 이동
export function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '늦은 시간이네요';
  if (h < 12) return '좋은 아침입니다';
  if (h < 18) return '좋은 오후입니다';
  return '좋은 저녁입니다';
}
