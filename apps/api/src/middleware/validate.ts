import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: result.error.flatten(),
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateParams<T extends Request['params']>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid route parameters',
          details: result.error.flatten(),
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    req.params = result.data;
    next();
  };
}

export function validateQuery<T extends Request['query']>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: result.error.flatten(),
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    req.query = result.data;
    next();
  };
}
