import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import type { UserRole } from '@/stores/auth.store';

interface RoleRouteProps {
  allowedRoles: UserRole[];
  /** Where to redirect if access is denied. Defaults to '/routine'. */
  redirectTo?: string;
  children: React.ReactNode;
}

/**
 * Wraps a route and redirects to `redirectTo` if the current user's role
 * is not in `allowedRoles`.  Must be used inside an authenticated route tree.
 */
export default function RoleRoute({
  allowedRoles,
  redirectTo = '/routine',
  children,
}: RoleRouteProps) {
  const user = useAuthStore((s) => s.user);

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
