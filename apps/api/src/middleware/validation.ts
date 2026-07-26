import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export function validateBody(schema: ZodType) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const result = schema.safeParse(request.body);
    if (!result.success) return next(result.error);
    request.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodType) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const result = schema.safeParse(request.query);
    if (!result.success) return next(result.error);
    Object.defineProperty(request, 'query', {
      value: result.data as Request['query'],
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
