import { useState } from 'react';
import Button from '../../components/Button';
import Field from '../../components/Field';
import { requestReset, verifyReset, confirmReset } from '../../lib/api';
import { validateEmail, validatePassword, getPasswordErrorMessage } from '../../lib/validate';
import AuthLayout from './AuthLayout';

// LittleBoss.jsx:436-543 이관. 3단계 흐름과 문구는 유지하되 토스트의 이모지는 모두 제거한다.
export default function ForgotPasswordPage({ toast, goLogin }) {
  const [step, setStep] = useState(1); // 1: email, 2: code, 3: password reset
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleEmailSubmit = async () => {
    if (!email) { toast('이메일을 입력해주세요'); return; }
    if (!validateEmail(email)) { toast('이메일 형식이 올바르지 않습니다'); return; }
    setBusy(true);
    try {
      await requestReset(email);
      toast('인증 코드를 이메일로 발송했어요');
      setStep(2);
    } catch (e) {
      toast(e.response?.data?.message || '발송 중 오류가 발생했어요');
    } finally { setBusy(false); }
  };

  const handleCodeSubmit = async () => {
    if (!code) { toast('인증 코드를 입력해주세요'); return; }
    setBusy(true);
    try {
      const { data } = await verifyReset(email, code);
      if (!data.success) throw new Error(data.message);
      toast('코드가 확인되었어요');
      setStep(3);
    } catch (e) {
      toast(e.response?.data?.message || e.message || '코드 확인에 실패했어요');
    } finally { setBusy(false); }
  };

  const handlePasswordReset = async () => {
    const passwordError = getPasswordErrorMessage(newPassword);
    if (passwordError) { toast(passwordError); return; }
    if (!confirmPassword) { toast('비밀번호 확인을 입력해주세요'); return; }
    if (newPassword !== confirmPassword) { toast('비밀번호가 일치하지 않습니다'); return; }
    setBusy(true);
    try {
      const { data } = await confirmReset(email, code, newPassword);
      if (!data.success) throw new Error(data.message);
      toast('비밀번호가 재설정되었어요');
      goLogin();
    } catch (e) {
      toast(e.response?.data?.message || e.message || '재설정에 실패했어요');
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      {step === 1 && (
        <>
          <h2 className="auth-title">비밀번호 재설정</h2>
          <p className="auth-subtitle">가입한 이메일을 입력하면 인증 코드를 보내드립니다</p>
          <Field
            label="이메일"
            type="email"
            placeholder="example@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={email && !validateEmail(email) ? '이메일 형식이 올바르지 않습니다' : undefined}
          />
          <Button variant="primary" size="md" disabled={busy} onClick={handleEmailSubmit}>
            {busy ? '발송 중...' : '이메일 보내기'}
          </Button>
          <div className="auth-footer">
            <button type="button" className="auth-link" onClick={goLogin}>로그인으로 돌아가기</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="auth-title">인증 코드 입력</h2>
          <p className="auth-subtitle">이메일로 받은 인증 코드를 입력해주세요</p>
          <Field
            label="인증 코드"
            type="text"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
          />
          <Button variant="primary" size="md" disabled={busy} onClick={handleCodeSubmit}>
            {busy ? '확인 중...' : '코드 확인'}
          </Button>
          <div className="auth-footer">
            <button type="button" className="auth-link" onClick={() => setStep(1)}>이전 단계로</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="auth-title">비밀번호 재설정</h2>
          <p className="auth-subtitle">새로운 비밀번호를 입력해주세요</p>
          <Field
            label="새 비밀번호"
            type="password"
            placeholder="8자 이상 입력"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="영문, 숫자, 특수문자 포함 8자 이상"
            error={newPassword && !validatePassword(newPassword) ? '영문, 숫자, 특수문자를 모두 포함해야 합니다' : undefined}
          />
          <Field
            label="비밀번호 확인"
            type="password"
            placeholder="비밀번호 재입력"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button variant="primary" size="md" disabled={busy} onClick={handlePasswordReset}>
            {busy ? '처리 중...' : '비밀번호 재설정'}
          </Button>
          <div className="auth-footer">
            <button type="button" className="auth-link" onClick={() => setStep(2)}>이전 단계로</button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
