import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';

interface RealtimeNotification {
  id: string;
  userId?: string;
  type?: string;
  title?: string;
  body?: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

function resolveSocketUrl() {
  // Local `npm run dev`: use the Vite origin so Socket.IO hits `/socket.io` on the dev server
  // and vite.config.ts proxies WebSocket + HTTP to FastAPI (default 3001). Avoids a stray
  // VITE_SOCKET_URL (e.g. :8001) breaking realtime notifications.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return window.location.origin;
  }

  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL as string;
  }

  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
}

function invalidateLinkedData(queryClient: ReturnType<typeof useQueryClient>, notification: RealtimeNotification) {
  const metadata = notification.metadata ?? {};
  const courseId = typeof metadata.courseId === 'string' ? metadata.courseId : undefined;
  const communityId = typeof metadata.communityId === 'string' ? metadata.communityId : undefined;

  if (courseId) {
    queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    queryClient.invalidateQueries({ queryKey: ['my-courses'] });
    queryClient.invalidateQueries({ queryKey: ['analytics-course', courseId] });
    queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
  }

  if (communityId) {
    queryClient.invalidateQueries({ queryKey: ['community', communityId] });
    queryClient.invalidateQueries({ queryKey: ['announcements', communityId] });
    queryClient.invalidateQueries({ queryKey: ['community-scores', communityId] });
    queryClient.invalidateQueries({ queryKey: ['marks-history', communityId] });
  }
}

export function useNotificationSocket() {
  const queryClient = useQueryClient();
  const { accessToken, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    const socketUrl = resolveSocketUrl();
    const socket: Socket = io(socketUrl, {
      auth: { token: accessToken },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socket.on('notification:new', (notification: RealtimeNotification) => {
      if (notification.id && notification.title) {
        queryClient.setQueryData(
          ['notifications'],
          (existing: { data: RealtimeNotification[]; total?: number } | undefined) => {
            const list = existing?.data ?? (Array.isArray(existing) ? existing : []);
            const alreadyExists = list.some((n) => n.id === notification.id);
            if (alreadyExists) return existing;
            const updated = [notification, ...list];
            if (Array.isArray(existing)) return updated;
            return { ...(existing ?? {}), data: updated, total: (existing?.total ?? 0) + 1 };
          }
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }

      invalidateLinkedData(queryClient, notification);
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    socket.on('notification:update', (notification: Partial<RealtimeNotification>) => {
      if (!notification.id) {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        return;
      }

      queryClient.setQueryData(
        ['notifications'],
        (existing: { data: RealtimeNotification[] } | RealtimeNotification[] | undefined) => {
          const list = Array.isArray(existing) ? existing : (existing?.data ?? []);
          const updated = list.map((n) => (n.id === notification.id ? { ...n, ...notification } : n));
          if (Array.isArray(existing)) return updated;
          return { ...(existing ?? {}), data: updated };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });

      // When a score-update or material notification is patched, also refresh analytics
      if (notification.metadata) {
        invalidateLinkedData(queryClient, notification as RealtimeNotification);
      }
    });

    socket.on('notification:count', ({ count }: { count: number }) => {
      queryClient.setQueryData(['notifications-unread-count'], count);
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, isAuthenticated, queryClient]);
}
