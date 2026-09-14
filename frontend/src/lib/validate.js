// 이메일/비밀번호 형식 검증 — 로그인·회원가입·비밀번호 재설정 화면 공통.
export const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const validatePassword = (password) => {
  const hasEnglish = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+=\-[\]{};':"\\|,.<>/?]/.test(password);
  const isLongEnough = password.length >= 8;
  return hasEnglish && hasNumber && hasSpecial && isLongEnough;
};

export const getPasswordErrorMessage = (password) => {
  if (!password) return '비밀번호를 입력해주세요';
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다';
  if (!/[a-zA-Z]/.test(password)) return '영문을 포함해주세요';
  if (!/\d/.test(password)) return '숫자를 포함해주세요';
  if (!/[!@#$%^&*()_+=\-[\]{};':"\\|,.<>/?]/.test(password)) return '특수기호를 포함해주세요';
  return null;
};
