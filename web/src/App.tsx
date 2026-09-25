/** 应用外壳：顶部导航 + 路由（仪表板 / 历史回放 / 数据源管理）。 */
import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useDashboard } from './store/useDashboard';
import DashboardPage from './pages/DashboardPage';
import ReplayPage from './pages/ReplayPage';
import SourcesPage from './pages/SourcesPage';
import Toasts from './components/Toasts';
import { formatClock } from './utils/format';

export default function App() {
  const connect = useDashboard((s) => s.connect);
  const lastTickTs = useDashboard((s) => s.lastTickTs);
  const activeCount = useDashboard((s) => s.actives.length);
  const criticalCount = useDashboard((s) => s.actives.filter((a) => a.level === 'critical').length);

  useEffect(() => connect(), [connect]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📈 运维实时监控仪表板</div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}>
            实时仪表板
          </NavLink>
          <NavLink to="/replay" className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}>
            历史回放
          </NavLink>
          <NavLink to="/sources" className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}>
            数据源管理
          </NavLink>
        </nav>
        <div className="topbar-meta">
          {criticalCount > 0 ? (
            <span className="meta-alert meta-critical">严重 {criticalCount}</span>
          ) : activeCount > 0 ? (
            <span className="meta-alert meta-warning">告警 {activeCount}</span>
          ) : (
            <span className="meta-alert meta-ok">无告警</span>
          )}
          <span className="meta-clock">最近节拍 {formatClock(lastTickTs)}</span>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/sources" element={<SourcesPage />} />
        </Routes>
      </main>
      <Toasts />
    </div>
  );
}
