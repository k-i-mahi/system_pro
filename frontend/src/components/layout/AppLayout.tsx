import { useEffect, useCallback } from 'react';
import { Outlet, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import { maybeStartOnboardingTour } from '@/lib/onboarding-tour';
import { useNotificationSocket } from '@/lib/notification-socket';
import api from '@/lib/api';

export default function AppLayout() {
  const { isAuthenticated, setUserFromMe, logout } = useAuthStore();
  const { sidebarCollapsed } = useUIStore();
  const navigate = useNavigate();

  useNotificationSocket();

  const refreshMe = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const { data } = await api.get('/auth/me');
      const me = data?.data ?? data;
      if (me?.id) setUserFromMe(me);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 404) {
        logout();
        navigate('/login', { replace: true });
      }
    }
  }, [isAuthenticated, setUserFromMe, logout, navigate]);

  useEffect(() => {
    refreshMe();
    const onFocus = () => refreshMe();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshMe]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const id = window.setTimeout(() => maybeStartOnboardingTour(), 400);
    return () => window.clearTimeout(id);
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }


  return (
    <div className="min-h-screen">
      <Sidebar />
      <div
        className={cn(
          'transition-all duration-300',
          sidebarCollapsed ? 'ml-16' : 'ml-50'
        )}
      >
        <Header />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
