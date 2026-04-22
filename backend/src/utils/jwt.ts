import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function generateAccessToken(userId: string): string {
  return jwt.sign({ userId, type: 'access' }, env.AUTH_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as string,
  } as jwt.SignOptions);
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, env.AUTH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES as string,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): { userId: string; type: string } {
  return jwt.verify(token, env.AUTH_SECRET) as { userId: string; type: string };
}
