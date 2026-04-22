import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route element={<AppLayout />}>
        <Route path="/routine" element={<RoutinePage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/courses/:courseId" element={<CourseDetailPage />} />
        <Route path="/ai-tutor" element={<AITutorPage />} />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/community/:id" element={<ClassroomDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/analytics/evaluation" element={<InstructorEvalPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/routine" replace />} />
    </Routes>
  );
}
