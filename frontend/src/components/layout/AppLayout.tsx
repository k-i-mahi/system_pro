import { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import { maybeStartOnboardingTour } from '@/lib/onboarding-tour';
import { useNotificationSocket } from '@/lib/notification-socket';

export default function AppLayout() {
  const { isAuthenticated } = useAuthStore();
  const { sidebarCollapsed } = useUIStore();

  useNotificationSocket();

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
