import { useState, useEffect } from 'react';
import AppShell from './components/AppShell';
import Toast from './components/Toast';
import { useToast } from './lib/useToast';
import { useTheme } from './lib/useTheme';
import { isLoggedIn, clearSession } from './lib/auth';

import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import DashboardPage from './pages/DashboardPage';
import UploadPage from './pages/UploadPage';
import SchedulePage from './pages/SchedulePage';
import OngoingPage from './pages/OngoingPage';
import CompletedPage from './pages/CompletedPage';
import ScheduleDetailPage from './pages/ScheduleDetailPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import ProfilePage from './pages/profile/ProfilePage';

const TITLES = {
  'sub-home': '대시보드', 'sub-upload': '문서 업로드', 'sub-schedule': '일정 관리',
  'sub-ongoing': '진행 중인 문서', 'sub-completed': '완료된 문서', 'sub-profile': '내 정보',
  'schedule-detail': '일정 상세', 'doc-detail': '문서 상세',
};

export default function App() {
  useTheme(); // <html data-theme> 부착
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(params.get('page') || (isLoggedIn() ? 'app' : 'login'));
  const [sub, setSub] = useState(params.get('sub') || 'sub-home');
  const [prevSub, setPrevSub] = useState('sub-home');
  const [detailDay, setDetailDay] = useState(null);
  const [detailTitle, setDetailTitle] = useState(null);
  const [docData, setDocData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 768
  );
  const { msg, show, toast } = useToast();

  const navTo = (s, detail, data) => {
    if (s === 'schedule-detail' || s === 'doc-detail') setPrevSub(sub);
    setSub(s);
    if (detail) {
      if (typeof detail === 'number') setDetailDay(detail);
      else setDetailTitle(detail);
    }
    if (data) setDocData(data);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleLogin = (m) => { setPage('app'); setSub('sub-home'); toast(m); };
  const handleLogout = () => {
    clearSession();
    window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: null }));
    setPage('login');
    toast('로그아웃됐어요');
  };

  useEffect(() => {
    window.history.pushState({ sub, detailDay, detailTitle, docData }, null, '');
    const onPop = (e) => {
      if (!e.state) return;
      setSub(e.state.sub || 'sub-home');
      if (e.state.detailDay) setDetailDay(e.state.detailDay);
      if (e.state.detailTitle) setDetailTitle(e.state.detailTitle);
      if (e.state.docData) setDocData(e.state.docData);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [sub, detailDay, detailTitle, docData]);

  if (page === 'signup') return <><SignupPage onLogin={handleLogin} goLogin={() => setPage('login')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'login') return <><LoginPage onLogin={handleLogin} goSignup={() => setPage('signup')} goForgotPassword={() => setPage('forgot-password')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'forgot-password') return <><ForgotPasswordPage toast={toast} goLogin={() => setPage('login')} /><Toast msg={msg} show={show} /></>;

  const PAGES = {
    'sub-home': <DashboardPage onNavTo={navTo} />,
    'sub-upload': <UploadPage onNavTo={navTo} />,
    'sub-schedule': <SchedulePage onNavTo={navTo} />,
    'sub-ongoing': <OngoingPage onNavTo={navTo} toast={toast} />,
    'sub-completed': <CompletedPage onNavTo={navTo} toast={toast} />,
    'sub-profile': <ProfilePage toast={toast} onLogout={handleLogout} />,
    'schedule-detail': <ScheduleDetailPage day={detailDay} title={detailTitle} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
    'doc-detail': <DocumentDetailPage data={docData} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
  };

  return (
    <>
      <AppShell sub={sub} onNavTo={navTo} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onLogout={handleLogout}>
        <h1 className="page-title">{TITLES[sub]}</h1>
        {PAGES[sub]}
      </AppShell>
      <Toast msg={msg} show={show} />
    </>
  );
}
