import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/auth-context';
import { Spinner } from '@/components/ui/spinner';

import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import HomePage from './pages/HomePage';
import DashboardLayout from './pages/DashboardLayout';
import DashboardOverviewPage from './pages/DashboardOverviewPage';
import ProjectsPage from './pages/ProjectsPage';
import WorkBreakdownPage from './pages/WorkBreakdownPage';
import DailyReportsPage from './pages/DailyReportsPage';
import ReportsPage from './pages/ReportsPage';
import TeamReportsPage from './pages/TeamReportsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

// 已登录访问登录系页面/首页时跳仪表盘；未登录时放行（原 middleware 逻辑）
function RequireGuest() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/dashboard/overview" replace />;
  return <Outlet />;
}

// 未登录访问 /dashboard/* 时跳登录页（原 middleware 逻辑）
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<DashboardOverviewPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="work-breakdown" element={<WorkBreakdownPage />} />
          <Route path="daily-reports" element={<DailyReportsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="team-reports" element={<TeamReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
