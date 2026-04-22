import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { Role } from '@prisma/client';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: Role;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  const token = header.slice(7);

  try {
    // Check if token is blacklisted
    const blacklisted = await redis.get(`bl:${token}`);
    if (blacklisted) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token revoked' } });
      return;
    }

    const payload = jwt.verify(token, env.AUTH_SECRET) as { userId: string; type: string };
    if (payload.type !== 'access') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token type' } });
      return;
    }

    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}

export function requireRole(...roles: Role[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      return;
    }

    try {
      if (!req.userRole) {
        const user = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { role: true },
        });
        if (!user) {
          res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not found' } });
          return;
        }
        req.userRole = user.role;
      }

      if (!roles.includes(req.userRole)) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        return;
      }

      next();
    } catch {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to check permissions' } });
    }
  };
}
