import { Response } from 'express';

export function success<T>(res: Response, data: T, meta?: { page: number; limit: number; total: number }) {
  res.json({ success: true, data, ...(meta && { meta }) });
}

export function created<T>(res: Response, data: T) {
  res.status(201).json({ success: true, data });
}

export function error(res: Response, status: number, code: string, message: string, details?: any) {
  res.status(status).json({ success: false, error: { code, message, ...(details && { details }) } });
}
