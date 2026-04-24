import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  BookOpen,
  Bot,
  Users,
  BarChart3,
  Settings,
  Shield,
  User,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

const navItems = [
  { to: '/routine', icon: CalendarDays, label: 'My Routine', tour: undefined },
  { to: '/courses', icon: BookOpen, label: 'Courses', tour: 'courses' },
  { to: '/ai-tutor', icon: Bot, label: 'AI Tutor', tour: 'ai-tutor' },
  { to: '/community', icon: Users, label: 'Community', tour: undefined },
  { to: '/analytics', icon: BarChart3, label: 'Analytics', tour: 'analytics' },
  { to: '/settings', icon: Settings, label: 'Settings', tour: undefined },
  { to: '/profile', icon: User, label: 'Account', tour: undefined },
];

export default function Sidebar() {
  const { logout } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const { sidebarCollapsed } = useUIStore();
  const items = user?.role === 'ADMIN' ? [...navItems, { to: '/admin', icon: Shield, label: 'Admin Panel', tour: undefined }] : navItems;

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore - clear local state regardless
    }
    logout();
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-bg-sidebar flex flex-col transition-all duration-300 z-30',
        sidebarCollapsed ? 'w-16' : 'w-50'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-white/10">
        {!sidebarCollapsed && (
          <span className="text-white font-bold text-lg tracking-tight">
            Cognitive Copilot
          </span>
        )}
        {sidebarCollapsed && (
          <span className="text-white font-bold text-lg mx-auto">CC</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-tour={item.tour}
            className={({ isActive }) =>
              cn(
                'sidebar-link',
                isActive ? 'sidebar-link-active' : 'sidebar-link-inactive',
                sidebarCollapsed && 'justify-center px-2'
              )
            }
            title={sidebarCollapsed ? item.label : undefined}
          >
            <item.icon size={20} />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-white/10">
        <button
          onClick={handleLogout}
          className={cn(
            'sidebar-link sidebar-link-inactive w-full',
            sidebarCollapsed && 'justify-center px-2'
          )}
        >
          <LogOut size={20} />
          {!sidebarCollapsed && <span>Log Out</span>}
        </button>
      </div>
    </aside>
  );
}
