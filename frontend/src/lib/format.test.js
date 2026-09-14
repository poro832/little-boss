import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deadlineInfo, formatDeadline, formatDeadlineWithLabel, deadlineTone, greeting } from './format';

// 모든 테스트를 2026-09-14로 고정한다. 실제 시간에 의존하면 내일 깨진다.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T10:30:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('formatDeadline', () => {
  it('미래 날짜는 D-N으로 표기한다', () => {
    expect(formatDeadline('2026-12-29')).toBe('D-106');
  });

  it('오늘은 D-Day로 표기한다', () => {
    expect(formatDeadline('2026-09-14')).toBe('D-Day');
  });

  it('시각이 지난 오늘도 D-Day다 (날짜 단위로만 비교)', () => {
    expect(formatDeadline('2026-09-14T01:00:00')).toBe('D-Day');
  });

  it('과거 날짜는 "N일 지남"으로 표기하며 음수 부호를 노출하지 않는다', () => {
    const out = formatDeadline('2026-06-22');
    expect(out).toBe('84일 지남');
    expect(out).not.toContain('-');
  });

  it('3년 전 같은 극단값에도 같은 규칙을 적용한다', () => {
    const out = formatDeadline('2023-07-21');
    expect(out).toMatch(/^\d+일 지남$/);
    expect(out).not.toContain('-');
  });

  it('null과 빈 문자열은 "마감일 없음"', () => {
    expect(formatDeadline(null)).toBe('마감일 없음');
    expect(formatDeadline('')).toBe('마감일 없음');
    expect(formatDeadline(undefined)).toBe('마감일 없음');
  });

  it('파싱할 수 없는 문자열은 "마감일 미정"', () => {
    expect(formatDeadline('언제까지')).toBe('마감일 미정');
    expect(formatDeadline('2026-13-45')).toBe('마감일 미정');
  });
});

describe('deadlineInfo', () => {
  it('미래 날짜의 days는 양수이고 isPast는 false', () => {
    expect(deadlineInfo('2026-12-29')).toEqual({
      hasDate: true, valid: true, days: 106, isPast: false,
    });
  });

  it('과거 날짜의 days는 음수이고 isPast는 true', () => {
    const info = deadlineInfo('2026-06-22');
    expect(info.days).toBe(-84);
    expect(info.isPast).toBe(true);
  });

  it('날짜가 없으면 hasDate가 false', () => {
    expect(deadlineInfo(null)).toEqual({
      hasDate: false, valid: false, days: null, isPast: false,
    });
  });

  it('파싱 불가면 valid가 false', () => {
    expect(deadlineInfo('언제까지')).toEqual({
      hasDate: true, valid: false, days: null, isPast: false,
    });
  });
});

describe('formatDeadlineWithLabel', () => {
  it('라벨이 있으면 앞에 붙인다', () => {
    expect(formatDeadlineWithLabel('신청 마감', '2026-09-18')).toBe('신청 마감 D-4');
  });

  it('라벨이 없으면 표기만 반환한다', () => {
    expect(formatDeadlineWithLabel('', '2026-09-18')).toBe('D-4');
    expect(formatDeadlineWithLabel(null, '2026-09-18')).toBe('D-4');
  });
});

describe('greeting', () => {
  it('시간대에 따라 인사말을 고른다', () => {
    vi.setSystemTime(new Date('2026-09-14T03:00:00'));
    expect(greeting()).toBe('늦은 시간이네요');
    vi.setSystemTime(new Date('2026-09-14T09:00:00'));
    expect(greeting()).toBe('좋은 아침입니다');
    vi.setSystemTime(new Date('2026-09-14T14:00:00'));
    expect(greeting()).toBe('좋은 오후입니다');
    vi.setSystemTime(new Date('2026-09-14T21:00:00'));
    expect(greeting()).toBe('좋은 저녁입니다');
  });
});

describe('deadlineTone', () => {
  it('3일 이내는 urgent', () => {
    expect(deadlineTone('2026-09-17')).toBe('urgent');
    expect(deadlineTone('2026-09-14')).toBe('urgent');
  });

  it('4일 이상 남으면 normal', () => {
    expect(deadlineTone('2026-09-18')).toBe('normal');
  });

  it('지났으면 past', () => {
    expect(deadlineTone('2026-06-22')).toBe('past');
  });

  it('날짜가 없거나 파싱 불가면 none', () => {
    expect(deadlineTone(null)).toBe('none');
    expect(deadlineTone('언제까지')).toBe('none');
  });
});
