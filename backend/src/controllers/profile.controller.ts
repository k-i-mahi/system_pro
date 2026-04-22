import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { uploadFile } from '../services/cloudinary.service.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import fs from 'fs';

export async function getProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true, name: true, email: true, universityName: true,
        avatarUrl: true, bio: true, phone: true, role: true,
        language: true, timezone: true, createdAt: true,
      },
    });
    if (!user) return resp.error(res, 404, 'NOT_FOUND', 'User not found');
    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: req.body,
      select: {
        id: true, name: true, email: true, universityName: true,
        avatarUrl: true, bio: true, phone: true,
      },
    });
    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) return resp.error(res, 400, 'NO_FILE', 'Please upload an image');

    const { secureUrl } = await uploadFile(req.file.path, 'avatars');
    fs.unlink(req.file.path, () => {});

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatarUrl: secureUrl },
      select: { id: true, avatarUrl: true },
    });

    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function deleteAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.user.delete({ where: { id: req.userId! } });
    resp.success(res, { message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
}
