import { useState } from 'react';
import Button from '../../components/Button';
import Field from '../../components/Field';
import { signup } from '../../lib/api';
import { saveSession } from '../../lib/auth';
import { validateEmail, validatePassword, getPasswordErrorMessage } from '../../lib/validate';
import AuthLayout, { GoogleAuthButton, DividerOr } from './AuthLayout';

// LittleBoss.jsx:314-384 이관.
// - 약관 동의 체크박스: label이 input을 감싸도록 바꿔 문구 클릭으로도 토글되게 한다
//   (원본은 label과 input이 분리돼 있어 문구를 눌러도 체크되지 않았다).
// - localStorage 직접 호출을 saveSession()으로 일원화.
export default function SignupPage({ onLogin, goLogin, toast }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSignup = async () => {
    if (!name) { toast('이름을 입력해주세요'); return; }
    if (!email) { toast('이메일을 입력해주세요'); return; }
    if (!validateEmail(email)) { toast('이메일 형식이 올바르지 않습니다'); return; }
    const passwordError = getPasswordErrorMessage(password);
    if (passwordError) { toast(passwordError); return; }
    if (!confirmPassword) { toast('비밀번호 확인을 입력해주세요'); return; }
    if (password !== confirmPassword) { toast('비밀번호가 일치하지 않습니다'); return; }
    if (!agreeTerms) { toast('약관에 동의해주세요'); return; }

    setSubmitting(true);
    try {
      const { data } = await signup(name, email, password);
      if (!data.success) { toast(data.message || '회원가입에 실패했어요'); return; }
      saveSession({ user_id: data.user_id, email: data.email, name: data.name });
      onLogin('회원가입이 완료됐어요!');
    } catch (e) {
      toast(e.response?.data?.message || '회원가입 중 오류가 발생했어요');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="auth-title">회원가입</h2>
      <p className="auth-subtitle">계정을 만들고 AI 행정 비서를 시작하세요</p>
      <GoogleAuthButton label="Google로 계속하기" onLogin={onLogin} toast={toast} />
      <DividerOr />
      <Field label="이름" type="text" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} />
      <Field
        label="이메일"
        type="email"
        placeholder="example@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={email && !validateEmail(email) ? '이메일 형식이 올바르지 않습니다' : undefined}
      />
      <Field
        label="비밀번호"
        type="password"
        placeholder="8자 이상 입력"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="영문, 숫자, 특수문자 포함 8자 이상"
        error={password && !validatePassword(password) ? '영문, 숫자, 특수문자를 모두 포함해야 합니다' : undefined}
      />
      <Field
        label="비밀번호 확인"
        type="password"
        placeholder="비밀번호 재입력"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <label className="terms-row">
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
        />
        <span>
          <a href="#" onClick={(e) => e.preventDefault()}>이용약관</a> 및{' '}
          <a href="#" onClick={(e) => e.preventDefault()}>개인정보 처리방침</a>에 동의합니다.
        </span>
      </label>
      <Button variant="primary" size="md" disabled={submitting} onClick={handleSignup}>
        {submitting ? '처리 중...' : '가입하기'}
      </Button>
      <div className="auth-footer">
        이미 계정이 있으신가요? <button type="button" className="auth-link" onClick={goLogin}>로그인</button>
      </div>
    </AuthLayout>
  );
}
