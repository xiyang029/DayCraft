import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/auth-context';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import OfflinePage from './pages/OfflinePage';
import SharePage from './pages/SharePage';
import DashboardLayout from './pages/DashboardLayout';
import DashboardOverviewPage from './pages/DashboardOverviewPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectProgressPage from './pages/ProjectProgressPage';
import WorkBreakdownPage from './pages/WorkBreakdownPage';
import TodosPage from './pages/TodosPage';
import DailyReportsPage from './pages/DailyReportsPage';
import NewDailyReportPage from './pages/NewDailyReportPage';
import ReportsPage from './pages/ReportsPage';
import ProjectReportsPage from './pages/ProjectReportsPage';
import NewProjectWeeklyReportPage from './pages/NewProjectWeeklyReportPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500" />
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
  if (!user) return <Navigate to="/login" replace />;
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

      <Route path="/offline" element={<OfflinePage />} />
      <Route path="/share/:token" element={<SharePage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<DashboardOverviewPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/progress" element={<ProjectProgressPage />} />
          <Route path="work-breakdown" element={<WorkBreakdownPage />} />
          <Route path="todos" element={<TodosPage />} />
          <Route path="daily-reports" element={<DailyReportsPage />} />
          <Route path="daily-reports/new" element={<NewDailyReportPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="project-reports" element={<ProjectReportsPage />} />
          <Route path="project-reports/new" element={<NewProjectWeeklyReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
