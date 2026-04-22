import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.userId! },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { userId: req.userId! } }),
    ]);

    resp.success(res, notifications, { page, limit, total });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.notification.update({
      where: { id: req.params.id, userId: req.userId! },
      data: { isRead: true },
    });
    resp.success(res, { message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.userId!, isRead: false },
      data: { isRead: true },
    });
    resp.success(res, { message: 'All marked as read' });
  } catch (err) {
    next(err);
  }
}

export async function deleteNotification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.notification.delete({
      where: { id: req.params.id, userId: req.userId! },
    });
    resp.success(res, { message: 'Notification deleted' });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.userId!, isRead: false },
    });
    resp.success(res, { count });
  } catch (err) {
    next(err);
  }
}
