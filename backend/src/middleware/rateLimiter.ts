import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests, try again later' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: any) => req.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'AI tutor rate limit reached' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req: any) => req.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Upload limit reached, try again later' } },
  standardHeaders: true,
  legacyHeaders: false,
});
