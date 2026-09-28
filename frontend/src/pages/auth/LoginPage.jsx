import { useState } from 'react';
import Button from '../../components/Button';
import Field from '../../components/Field';
import { CheckCircle } from '../../icons';
import { emailLogin } from '../../lib/api';
import { saveSession } from '../../lib/auth';
import { validateEmail } from '../../lib/validate';
import AuthLayout, { GoogleAuthButton, DividerOr } from './AuthLayout';

// LittleBoss.jsx:386-434 이관.
// - 로그인 상태 유지 안내(auth-persist)를 추가: 자동 로그인은 이미 동작하지만 화면에 드러나지 않아
//   사용자가 매번 로그인해야 하는 줄 알았던 문제를 해소한다.
// - localStorage 직접 호출을 saveSession()으로 일원화.
// - 입력 오류는 회원가입과 같이 해당 칸 아래 인라인으로 보여준다. 화면 구석 토스트로만
//   알리면 어느 칸이 잘못됐는지 알 수 없고, 같은 실수인데 화면마다 표현이 달라진다.
export default function LoginPage({ onLogin, goSignup, goForgotPassword, toast }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);   // 제출을 시도한 뒤에만 빈 칸을 지적한다
  const [formError, setFormError] = useState('');  // 특정 칸이 아니라 조합이 틀린 경우

  // 형식 오류는 입력 중 바로, 빈 칸은 제출을 눌렀을 때만 알린다.
  const emailError =
    email && !validateEmail(email) ? '이메일 형식이 올바르지 않습니다'
      : touched && !email ? '이메일을 입력해주세요'
        : undefined;
  const passwordError = touched && !password ? '비밀번호를 입력해주세요' : undefined;

  const edit = (setter) => (e) => {
    setter(e.target.value);
    if (formError) setFormError('');   // 고치기 시작하면 이전 실패 메시지는 치운다
  };

  const handleLogin = async () => {
    setTouched(true);
    setFormError('');
    if (!email || !validateEmail(email) || !password) return;  // 오류는 각 칸 아래에 이미 보인다

    setSubmitting(true);
    try {
      const { data } = await emailLogin(email, password);
      if (!data.success) { setFormError(data.message || '이메일 또는 비밀번호가 올바르지 않습니다'); return; }
      saveSession({ user_id: data.user_id, email: data.email, name: data.name });
      onLogin('로그인됐어요');
    } catch (e) {
      // 네트워크·서버 장애는 화면 문제가 아니므로 토스트로 알린다.
      toast(e.response?.data?.message || '로그인 중 오류가 발생했어요');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="auth-title">로그인</h2>
      <p className="auth-subtitle">계정에 로그인해 주세요</p>
      <GoogleAuthButton label="Google 로그인" onLogin={onLogin} toast={toast} />
      <DividerOr />
      <Field
        label="이메일"
        type="email"
        placeholder="example@email.com"
        value={email}
        onChange={edit(setEmail)}
        error={emailError}
      />
      <Field
        label="비밀번호"
        type="password"
        placeholder="비밀번호 입력"
        value={password}
        onChange={edit(setPassword)}
        error={passwordError}
      />
      {formError && <div className="auth-form-error" role="alert">{formError}</div>}
      <Button variant="primary" size="md" disabled={submitting} onClick={handleLogin}>
        {submitting ? '로그인 중...' : '로그인'}
      </Button>
      <div className="auth-persist">
        <CheckCircle size={15} />
        <span>로그인 상태가 유지됩니다. 다음 방문에는 바로 대시보드로 들어갑니다.</span>
      </div>
      <div className="auth-forgot-link">
        <button type="button" className="auth-link-plain" onClick={goForgotPassword}>비밀번호를 잊으셨나요?</button>
      </div>
      <div className="auth-footer">
        계정이 없으신가요? <button type="button" className="auth-link" onClick={goSignup}>회원가입</button>
      </div>
    </AuthLayout>
  );
}
