export * from './src/lib/api';
export { deadlineInfo as ddayInfoRaw, formatDeadline } from './src/lib/format';
// LittleBoss.jsx가 쓰던 형태를 유지하기 위한 임시 어댑터
import { deadlineInfo, formatDeadline } from './src/lib/format';
export function ddayInfo(dateStr) {
  const i = deadlineInfo(dateStr);
  return { text: formatDeadline(dateStr), isPast: i.isPast, days: i.days };
}
