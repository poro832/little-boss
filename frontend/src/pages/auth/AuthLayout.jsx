import { useGoogleLogin } from '@react-oauth/google';
import logo from '../../../logo.svg';
import { Calendar, ListCheck, Bell } from '../../icons';
import { saveSession, saveCalendarToken } from '../../lib/auth';
import { useIsMobile } from '../../lib/useIsMobile';

// LittleBoss.jsx:179-255 이관.
// 브랜드 패널은 --brand-gradient를 쓴다. 랜딩용 FlowIllustration(장식 SVG)은 이관하지 않고,
// Feature 항목 아이콘을 세트에서 가져온 Calendar/ListCheck/Bell로 교체한다.
const FEATURES = [
  { icon: Calendar, title: '마감일 자동 추출', desc: '문서 속 마감일을 놓치지 않게 자동 정리' },
  { icon: ListCheck, title: '준비서류 체크리스트', desc: '필요한 서류를 한눈에, 진행률까지' },
  { icon: Bell, title: '캘린더 자동 등록', desc: '마감 D-7 · D-3 · D-1 리마인더까지 자동' },
];

export default function AuthLayout({ children }) {
  // 원본은 <=900px에서 단일 카드로 폴백한다. useIsMobile(bp)는 `< bp`로 판정하므로 901을 넘긴다.
  const narrow = useIsMobile(901);

  const brandHeader = (
    <div className="auth-brand-header-sm">
      <img src={logo} alt="LittleBoss" className="auth-brand-logo-sm" />
      <span className="auth-brand-name-sm">LittleBoss</span>
    </div>
  );

  if (narrow) {
    return (
      <div className="auth-shell-narrow">
        <div className="auth-narrow-card">
          {brandHeader}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <div className="auth-blob auth-blob-1" aria-hidden="true" />
        <div className="auth-blob auth-blob-2" aria-hidden="true" />
        <div className="auth-brand-content">
          <div className="auth-brand-header">
            <img src={logo} alt="LittleBoss" className="auth-brand-logo" />
            <span className="auth-brand-name">LittleBoss</span>
          </div>
          <h1 className="auth-brand-title">
            행정 서류,<br />AI가 대신 정리해드려요
          </h1>
          <p className="auth-brand-desc">
            공지문만 올리면 마감일 · 준비서류 · 일정을<br />자동으로 추출해 캘린더에 등록합니다.
          </p>
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div className="auth-feature" key={title}>
              <div className="auth-feature-icon">
                <Icon />
              </div>
              <div>
                <div className="auth-feature-title">{title}</div>
                <div className="auth-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-card-panel">
        <div className="auth-card-inner">
          {brandHeader}
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Google 로그인 버튼 (로그인/회원가입 화면 공통) ──
// 아래 4색은 Google의 고정 브랜드 컬러다. 서드파티 브랜드 마크는 디자인 시스템 토큰 대상이 아니므로
// 테마와 무관하게 항상 이 값을 그대로 쓴다 — 토큰으로 옮기지 않는다.
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export function GoogleAuthButton({ label, onLogin, toast }) {
  const login = useGoogleLogin({
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const user = await res.json();
        saveSession({ user_id: user.sub, email: user.email || '', name: user.name || '' });
        saveCalendarToken(accessToken);
        onLogin?.(`${user.name || '사용자'}님 환영합니다`);
      } catch (e) {
        onLogin?.('로그인됐어요 (사용자 정보 조회 실패)');
      }
    },
    onError: () => toast?.('Google 로그인 실패. 다시 시도해주세요.'),
  });

  return (
    <button type="button" className="auth-google-btn" onClick={() => login()}>
      <GoogleMark /> {label}
    </button>
  );
}

export function DividerOr() {
  return (
    <div className="auth-divider">
      <span className="auth-divider-line" />
      또는 이메일로
      <span className="auth-divider-line" />
    </div>
  );
}
