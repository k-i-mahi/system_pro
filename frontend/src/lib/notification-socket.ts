import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';

interface RealtimeNotification {
  id: string;
  isRead: boolean;
  createdAt: string;
}

function resolveSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL as string;
  }

  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
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
      queryClient.setQueryData(['notifications'], (existing: RealtimeNotification[] | undefined) => {
        if (!existing) {
          return [notification];
        }

        const alreadyExists = existing.some((n) => n.id === notification.id);
        if (alreadyExists) {
          return existing;
        }

        return [notification, ...existing];
      });
    });

    socket.on('notification:count', ({ count }: { count: number }) => {
      queryClient.setQueryData(['notifications-unread-count'], count);
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, isAuthenticated, queryClient]);
}
