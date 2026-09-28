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
  const [detailDay, setDetailDay] = useState(params.get('day') ? Number(params.get('day')) : null);
  const [detailTitle, setDetailTitle] = useState(params.get('title'));
  const [docData, setDocData] = useState(null);
  // 문서 상세는 객체 전체를 주소에 담을 수 없으므로 id만 싣고, 객체가 없으면
  // 상세 화면이 id로 직접 불러온다(새로고침·북마크 복원).
  const [docId, setDocId] = useState(params.get('doc'));
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 768
  );
  const { msg, show, toast } = useToast();

  // 현재 화면을 주소로 표현한다. 북마크·공유·새로고침 복원이 전부 여기에 달려 있다.
  const buildUrl = (s, day, title, id) => {
    const p = new URLSearchParams({ page: 'app', sub: s });
    if (s === 'schedule-detail') {
      if (typeof day === 'number') p.set('day', String(day));
      if (title) p.set('title', title);
    }
    if (s === 'doc-detail' && id) p.set('doc', id);
    return `${window.location.pathname}?${p.toString()}`;
  };

  const navTo = (s, detail, data) => {
    if (s === 'schedule-detail' || s === 'doc-detail') setPrevSub(sub);
    setSub(s);

    let nextDay = detailDay;
    let nextTitle = detailTitle;
    if (detail) {
      if (typeof detail === 'number') { setDetailDay(detail); nextDay = detail; }
      else { setDetailTitle(detail); nextTitle = detail; }
    }
    const nextId = (data && data.doc_id) || (s === 'doc-detail' ? docId : null);
    if (data) { setDocData(data); setDocId(data.doc_id || null); }
    if (window.innerWidth < 768) setSidebarOpen(false);

    // 문서 객체는 크고 직렬화가 까다로워 기록에는 id만 남긴다.
    window.history.pushState(
      { lb: true, sub: s, detailDay: nextDay, detailTitle: nextTitle, docId: nextId },
      '',
      buildUrl(s, nextDay, nextTitle, nextId)
    );
  };

  const handleLogin = (m) => { setPage('app'); setSub('sub-home'); toast(m); };
  const handleLogout = () => {
    clearSession();
    window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: null }));
    setPage('login');
    toast('로그아웃됐어요');
  };

  // 첫 진입 기록을 현재 화면으로 맞춰둔다. 이게 없으면 첫 화면에서 뒤로가기가 앱을 벗어난다.
  useEffect(() => {
    window.history.replaceState(
      { lb: true, sub, detailDay, detailTitle, docId },
      '',
      buildUrl(sub, detailDay, detailTitle, docId)
    );
    // 최초 1회만 — 의존성을 넣으면 화면이 바뀔 때마다 기록을 덮어쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 뒤로/앞으로: 상태를 되돌리기만 하고 새 기록을 만들지 않는다.
  // (이전 구현은 여기서 다시 pushState를 호출해 유령 기록이 쌓였고,
  //  그래서 한 화면을 되돌아가는 데 뒤로가기가 두 번 필요했다.)
  useEffect(() => {
    const onPop = (e) => {
      const st = e.state;
      if (!st || !st.lb) return;
      setSub(st.sub || 'sub-home');
      setDetailDay(st.detailDay ?? null);
      setDetailTitle(st.detailTitle ?? null);
      setDocId(st.docId ?? null);
      // 같은 문서면 이미 받아둔 객체를 재사용하고, 아니면 상세 화면이 id로 다시 불러온다.
      setDocData((cur) => (cur && cur.doc_id === st.docId ? cur : null));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (page === 'signup') return <><SignupPage onLogin={handleLogin} goLogin={() => setPage('login')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'login') return <><LoginPage onLogin={handleLogin} goSignup={() => setPage('signup')} goForgotPassword={() => setPage('forgot-password')} toast={toast} /><Toast msg={msg} show={show} /></>;
  if (page === 'forgot-password') return <><ForgotPasswordPage toast={toast} goLogin={() => setPage('login')} /><Toast msg={msg} show={show} /></>;

  const PAGES = {
    'sub-home': <DashboardPage onNavTo={navTo} />,
    'sub-upload': <UploadPage onNavTo={navTo} />,
    'sub-schedule': <SchedulePage onNavTo={navTo} toast={toast} />,
    'sub-ongoing': <OngoingPage onNavTo={navTo} toast={toast} />,
    'sub-completed': <CompletedPage onNavTo={navTo} toast={toast} />,
    'sub-profile': <ProfilePage toast={toast} onLogout={handleLogout} onNavTo={navTo} />,
    'schedule-detail': <ScheduleDetailPage day={detailDay} title={detailTitle} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
    'doc-detail': <DocumentDetailPage data={docData} docId={docId} prevSub={prevSub} onNavTo={navTo} toast={toast} />,
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
