import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword, getPasswordErrorMessage } from './validate';

describe('validateEmail', () => {
  it('정상적인 이메일 형식은 통과한다', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('@가 없으면 거부한다', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('도메인에 점이 없으면 거부한다', () => {
    expect(validateEmail('user@examplecom')).toBe(false);
  });

  it('공백이 있으면 거부한다', () => {
    expect(validateEmail('us er@example.com')).toBe(false);
  });

  it('빈 문자열은 거부한다', () => {
    expect(validateEmail('')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('영문+숫자+특수문자+8자 이상을 모두 만족하면 통과한다', () => {
    expect(validatePassword('Abc12!de')).toBe(true);
  });

  it('경계값: 정확히 8자(다른 규칙은 모두 충족)면 통과한다', () => {
    const pw = 'Abc12!de';
    expect(pw.length).toBe(8);
    expect(validatePassword(pw)).toBe(true);
  });

  it('경계값: 7자면(길이만 부족) 거부한다', () => {
    expect(validatePassword('Ab12!de')).toBe(false); // 7 chars
  });

  it('8자 미만이면 거부한다 (다른 규칙은 충족)', () => {
    expect(validatePassword('Ab1!')).toBe(false);
  });

  it('영문이 없으면 거부한다 (숫자·특수문자·길이는 충족)', () => {
    expect(validatePassword('12345678!')).toBe(false);
  });

  it('숫자가 없으면 거부한다 (영문·특수문자·길이는 충족)', () => {
    expect(validatePassword('Abcdefg!')).toBe(false);
  });

  it('특수문자가 없으면 거부한다 (영문·숫자·길이는 충족)', () => {
    expect(validatePassword('Abcdefg1')).toBe(false);
  });
});

describe('getPasswordErrorMessage', () => {
  it('유효한 비밀번호는 null을 반환한다', () => {
    expect(getPasswordErrorMessage('Abc12!de')).toBeNull();
  });

  it('빈 문자열은 길이 메시지가 아니라 입력 안내 메시지를 반환한다 (우선순위)', () => {
    expect(getPasswordErrorMessage('')).toBe('비밀번호를 입력해주세요');
  });

  it('8자 미만이면 길이 메시지를 반환한다 (다른 규칙은 충족)', () => {
    expect(getPasswordErrorMessage('Ab1!')).toBe('비밀번호는 8자 이상이어야 합니다');
  });

  it('영문이 없으면 영문 안내 메시지를 반환한다', () => {
    expect(getPasswordErrorMessage('12345678!')).toBe('영문을 포함해주세요');
  });

  it('숫자가 없으면 숫자 안내 메시지를 반환한다', () => {
    expect(getPasswordErrorMessage('Abcdefg!')).toBe('숫자를 포함해주세요');
  });

  it('특수기호가 없으면 특수기호 안내 메시지를 반환한다', () => {
    expect(getPasswordErrorMessage('Abcdefg1')).toBe('특수기호를 포함해주세요');
  });
});
