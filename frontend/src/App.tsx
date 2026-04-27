import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import RoleRoute from '@/components/auth/RoleRoute';
import { useAuthStore } from '@/stores/auth.store';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import RoutinePage from '@/pages/routine/RoutinePage';
import CoursesPage from '@/pages/courses/CoursesPage';
import CourseDetailPage from '@/pages/courses/CourseDetailPage';
import AITutorPage from '@/pages/ai-tutor/AITutorPage';
import CommunityPage from '@/pages/community/CommunityPage';
import ClassroomDetailPage from '@/pages/community/ClassroomDetailPage';
import NotificationsPage from '@/pages/notifications/NotificationsPage';
import AnalyticsPage from '@/pages/analytics/AnalyticsPage';
import InstructorEvalPage from '@/pages/analytics/InstructorEvalPage';
import LandingPage from '@/pages/landing/LandingPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import ProfilePage from '@/pages/profile/ProfilePage';
import AdminUsersPage from '@/pages/admin/AdminUsersPage';
import AdminThreadsPage from '@/pages/admin/AdminThreadsPage';
import AdminClassroomsPage from '@/pages/admin/AdminClassroomsPage';
import TutorDashboardPage from '@/pages/tutor/TutorDashboardPage';

function CoursesListGate() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'TUTOR') return <Navigate to="/community" replace />;
  return <CoursesPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<AppLayout />}>
        <Route path="/routine" element={<RoutinePage />} />
        <Route path="/courses" element={<CoursesListGate />} />
        <Route path="/courses/:courseId" element={<CourseDetailPage />} />
        <Route
          path="/ai-tutor"
          element={
            <RoleRoute allowedRoles={['STUDENT']}>
              <AITutorPage />
            </RoleRoute>
          }
        />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/community/threads/:threadId" element={<CommunityPage />} />
        {/* Without :threadId, :id would otherwise capture id="threads" on ClassroomDetailPage. */}
        <Route path="/community/threads" element={<Navigate to="/community" replace />} />
        <Route path="/community/:id" element={<ClassroomDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route
          path="/analytics"
          element={
            <RoleRoute allowedRoles={['STUDENT', 'ADMIN']}>
              <AnalyticsPage />
            </RoleRoute>
          }
        />
        <Route
          path="/analytics/evaluation"
          element={
            <RoleRoute allowedRoles={['ADMIN']} redirectTo="/routine">
              <InstructorEvalPage />
            </RoleRoute>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/dashboard"
          element={
            <RoleRoute allowedRoles={['TUTOR']} redirectTo="/routine">
              <TutorDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="/admin"
          element={<RoleRoute allowedRoles={['ADMIN']}><Navigate to="/admin/users" replace /></RoleRoute>}
        />
        <Route
          path="/admin/users"
          element={
            <RoleRoute allowedRoles={['ADMIN']}>
              <AdminUsersPage />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/threads"
          element={
            <RoleRoute allowedRoles={['ADMIN']}>
              <AdminThreadsPage />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/classrooms"
          element={
            <RoleRoute allowedRoles={['ADMIN']}>
              <AdminClassroomsPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/routine" replace />} />
    </Routes>
  );
}
