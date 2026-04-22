import { Bell, Menu, Search } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export default function Header() {
  const { user } = useAuthStore();
  const { toggleSidebar } = useUIStore();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data.data.count as number),
  });

  return (
    <header className="h-16 bg-bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="p-2 hover:bg-bg-main rounded-lg transition-colors"
        >
          <Menu size={20} className="text-text-secondary" />
        </button>
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search..."
            className="input pl-10 w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span data-tour="theme-toggle">
          <ThemeToggle />
        </span>
        <Link
          to="/notifications"
          className="relative p-2 hover:bg-bg-main rounded-lg transition-colors"
        >
          <Bell size={20} className="text-text-secondary" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] leading-4 text-center font-medium">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link to="/profile" className="flex items-center gap-2">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium">
              {user?.name?.charAt(0) || 'U'}
            </div>
          )}
          <span className="text-sm font-medium text-text-primary hidden sm:block">
            {user?.name}
          </span>
        </Link>
      </div>
    </header>
  );
}
