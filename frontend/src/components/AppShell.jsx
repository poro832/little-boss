import Header from './Header';
import Sidebar from './Sidebar';
import BottomTabs from './BottomTabs';
import { useIsMobile } from '../lib/useIsMobile';

export default function AppShell({ sub, onNavTo, sidebarOpen, setSidebarOpen, onLogout, children }) {
  const isMobile = useIsMobile();
  return (
    <div className="app-root">
      <Header
        onLogout={onLogout}
        onNavTo={onNavTo}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />
      <div className="app-body">
        <Sidebar currentSub={sub} onNavTo={onNavTo} sidebarOpen={sidebarOpen} />
        {isMobile && sidebarOpen && (
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
        )}
        <main className={`app-main ${sidebarOpen && !isMobile ? 'app-main-pushed' : ''}`}>
          {children}
        </main>
      </div>
      {isMobile && <BottomTabs currentSub={sub} onNavTo={onNavTo} />}
    </div>
  );
}
