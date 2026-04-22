import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';

export async function getSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        language: true, timezone: true, timeFormat: true, dateFormat: true,
        notifChat: true, notifNewestUpdate: true, notifMentorOfMonth: true, notifCourseOfMonth: true,
      },
    });
    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateGeneral(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: req.body,
      select: { language: true, timezone: true, timeFormat: true, dateFormat: true },
    });
    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updatePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return resp.error(res, 404, 'NOT_FOUND', 'User not found');

    const valid = await comparePassword(oldPassword, user.passwordHash);
    if (!valid) return resp.error(res, 400, 'INVALID_PASSWORD', 'Current password is incorrect');

    if (oldPassword === newPassword) {
      return resp.error(res, 400, 'SAME_PASSWORD', 'New password must differ from current');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.userId! }, data: { passwordHash } });

    resp.success(res, { message: 'Password updated' });
  } catch (err) {
    next(err);
  }
}

export async function updateNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: req.body,
      select: {
        notifChat: true, notifNewestUpdate: true,
        notifMentorOfMonth: true, notifCourseOfMonth: true,
      },
    });
    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}
