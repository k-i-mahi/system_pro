import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../utils/jwt.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import crypto from 'crypto';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { universityName, name, email, password, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return resp.error(res, 409, 'CONFLICT', 'Email already registered');
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        universityName,
        name,
        email,
        passwordHash,
        role: role || 'STUDENT',
      },
      select: { id: true, name: true, email: true, universityName: true, role: true, avatarUrl: true, rollNumber: true, session: true, department: true },
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token in Redis (7 days TTL)
    await redis.set(`rt:${user.id}:${refreshToken}`, '1', 'EX', 7 * 24 * 60 * 60);

    resp.created(res, { accessToken, refreshToken, user });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return resp.error(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return resp.error(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await redis.set(`rt:${user.id}:${refreshToken}`, '1', 'EX', 7 * 24 * 60 * 60);

    resp.success(res, {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        universityName: user.universityName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        rollNumber: user.rollNumber,
        session: user.session,
        department: user.department,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;

    let payload: { userId: string; type: string };
    try {
      payload = verifyToken(refreshToken);
    } catch {
      return resp.error(res, 401, 'INVALID_TOKEN', 'Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      return resp.error(res, 401, 'INVALID_TOKEN', 'Not a refresh token');
    }

    const stored = await redis.get(`rt:${payload.userId}:${refreshToken}`);
    if (!stored) {
      return resp.error(res, 401, 'INVALID_TOKEN', 'Refresh token expired or revoked');
    }

    // Rotate: delete old, issue new
    await redis.del(`rt:${payload.userId}:${refreshToken}`);
    const newAccess = generateAccessToken(payload.userId);
    const newRefresh = generateRefreshToken(payload.userId);
    await redis.set(`rt:${payload.userId}:${newRefresh}`, '1', 'EX', 7 * 24 * 60 * 60);

    resp.success(res, { accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.slice(7);
    if (token) {
      // Blacklist the access token for its remaining TTL (max 15 min)
      await redis.set(`bl:${token}`, '1', 'EX', 15 * 60);
    }

    // Also revoke any refresh token sent in body
    const { refreshToken } = req.body || {};
    if (refreshToken && req.userId) {
      await redis.del(`rt:${req.userId}:${refreshToken}`);
    }

    resp.success(res, { message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether email exists
      return resp.success(res, { message: 'If the email exists, a reset code has been sent' });
    }

    const otp = crypto.randomInt(1000, 9999).toString();
    await redis.set(`otp:${email}`, otp, 'EX', 5 * 60); // 5 min TTL

    // In production, send email here
    console.log(`[DEV] OTP for ${email}: ${otp}`);

    resp.success(res, { message: 'If the email exists, a reset code has been sent' });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, otp } = req.body;

    const stored = await redis.get(`otp:${email}`);
    if (!stored || stored !== otp) {
      return resp.error(res, 400, 'INVALID_OTP', 'Invalid or expired OTP');
    }

    // Generate a short-lived reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    await redis.set(`reset:${resetToken}`, email, 'EX', 10 * 60);
    await redis.del(`otp:${email}`);

    resp.success(res, { token: resetToken });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = req.body;

    const email = await redis.get(`reset:${token}`);
    if (!email) {
      return resp.error(res, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    await redis.del(`reset:${token}`);

    resp.success(res, { message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true, name: true, email: true, universityName: true,
        avatarUrl: true, bio: true, phone: true, role: true,
        rollNumber: true, session: true, department: true,
        language: true, timezone: true, timeFormat: true, dateFormat: true,
        notifChat: true, notifNewestUpdate: true, notifMentorOfMonth: true, notifCourseOfMonth: true,
        createdAt: true,
      },
    });

    if (!user) {
      return resp.error(res, 404, 'NOT_FOUND', 'User not found');
    }

    resp.success(res, user);
  } catch (err) {
    next(err);
  }
}
