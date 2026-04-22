import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const err: any = new Error('Validation failed');
      err.name = 'ZodError';
      err.errors = result.error.errors;
      return next(err);
    }
    req[source] = result.data;
    next();
  };
}
