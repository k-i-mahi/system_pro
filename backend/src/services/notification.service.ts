import { prisma } from '../config/database.js';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, any>;
}

export async function createNotification(params: CreateNotificationParams) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? undefined,
    },
  });

  // Try to emit via Socket.io (non-blocking)
  try {
    const { getIO } = await import('../config/socket.js');
    const io = getIO();
    io.to(`user:${params.userId}`).emit('notification:new', notification);

    const count = await prisma.notification.count({
      where: { userId: params.userId, isRead: false },
    });
    io.to(`user:${params.userId}`).emit('notification:count', { count });
  } catch {
    // Socket not initialized — skip
  }

  return notification;
}
